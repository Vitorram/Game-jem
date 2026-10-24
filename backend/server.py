"""Small WebSocket relay for Suburban's three-player cooperative mode."""

from __future__ import annotations

import asyncio
import json
import math
import os
import secrets
import string
import time
from dataclasses import dataclass, field
from typing import Any

from websockets.asyncio.server import ServerConnection, serve


MAX_PLAYERS = 3
ROOM_CODE_SIZE = 5
COUNTDOWN_MS = 5_000
PORT = int(os.environ.get("COOP_PORT", "8765"))
VALID_ROLES = {1, 2, 3}
VALID_TEAMS = {"infraestrutura", "mobilidade"}
VALID_PUZZLES = {"pole", "signal", "sensor", "car", "signal-check", "charger"}
VALID_MOBILITY_KEYS = {"Digit1", "Digit2", "Digit3", "Digit4"}
CODE_ALPHABET = string.ascii_uppercase + "23456789"


def now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass
class PlayerSlot:
    player_id: str
    name: str
    role: int
    websocket: ServerConnection
    ready: bool = False


@dataclass
class Room:
    code: str
    host_id: str
    players: dict[str, PlayerSlot] = field(default_factory=dict)
    status: str = "lobby"
    start_at: int | None = None
    countdown_task: asyncio.Task[None] | None = None


rooms: dict[str, Room] = {}
connections: dict[ServerConnection, tuple[Room, str]] = {}
send_locks: dict[ServerConnection, asyncio.Lock] = {}


def clean_name(value: Any) -> str:
    if not isinstance(value, str):
        return "Jogador"
    return " ".join(value.strip().split())[:20] or "Jogador"


def snapshot(room: Room) -> dict[str, Any]:
    return {
        "code": room.code,
        "hostId": room.host_id,
        "status": room.status,
        "startAt": room.start_at,
        "serverTime": now_ms(),
        "players": [
            {"id": player.player_id, "name": player.name, "role": player.role, "ready": player.ready}
            for player in room.players.values()
        ],
    }


async def send_json(websocket: ServerConnection, payload: dict[str, Any]) -> None:
    lock = send_locks.get(websocket)
    if lock is None:
        lock = asyncio.Lock()
        send_locks[websocket] = lock
    try:
        async with lock:
            await websocket.send(json.dumps(payload, separators=(",", ":")))
    except Exception:
        pass


async def broadcast(room: Room, payload: dict[str, Any]) -> None:
    await asyncio.gather(*(send_json(player.websocket, payload) for player in tuple(room.players.values())))


async def broadcast_room(room: Room) -> None:
    await broadcast(room, {"type": "room", "room": snapshot(room)})


def game_has_started(room: Room) -> bool:
    return room.status == "running" or (room.status == "countdown" and room.start_at is not None and now_ms() >= room.start_at)


def valid_player_id(value: Any) -> bool:
    return isinstance(value, str) and 8 <= len(value) <= 80


def valid_role(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value in VALID_ROLES


def free_role(room: Room, role: int) -> bool:
    return role in VALID_ROLES and all(player.role != role for player in room.players.values())


def new_code() -> str:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(ROOM_CODE_SIZE))
        if code not in rooms:
            return code


async def fail(websocket: ServerConnection, message: str) -> None:
    await send_json(websocket, {"type": "error", "message": message})


async def handle_admission(websocket: ServerConnection, message: dict[str, Any]) -> Room | None:
    kind = message.get("type")
    player_id = message.get("playerId")
    role = message.get("role")
    if not valid_player_id(player_id):
        await fail(websocket, "Identificador de jogador inválido. Recarregue a página.")
        return None
    if not valid_role(role):
        await fail(websocket, "Escolha um dos três personagens antes de entrar.")
        return None
    name = clean_name(message.get("name"))

    if kind == "create":
        code = new_code()
        room = Room(code=code, host_id=player_id)
        room.players[player_id] = PlayerSlot(player_id, name, role, websocket)
        rooms[code] = room
    elif kind == "join":
        code = str(message.get("code", "")).strip().upper()
        room = rooms.get(code)
        if room is None:
            await fail(websocket, "Sala não encontrada. Confira o código e tente de novo.")
            return None
        if room.status != "lobby":
            await fail(websocket, "Essa partida já começou.")
            return None
        if len(room.players) >= MAX_PLAYERS:
            await fail(websocket, "A sala já está completa (3 jogadores).")
            return None
        if not free_role(room, role):
            await fail(websocket, "Esse personagem já foi escolhido. Selecione outro.")
            return None
        room.players[player_id] = PlayerSlot(player_id, name, role, websocket)
    else:
        await fail(websocket, "Primeiro crie uma sala ou entre usando um código.")
        return None

    connections[websocket] = (room, player_id)
    await send_json(websocket, {"type": "room", "room": snapshot(room)})
    await broadcast_room(room)
    return room


def valid_action(action: Any) -> bool:
    if not isinstance(action, dict) or not isinstance(action.get("kind"), str):
        return False
    kind = action.get("kind")
    if kind in {"interact", "select-problem", "analyze", "dispatch", "reinforce", "archive", "mobility", "repair"}:
        if kind in {"select-problem", "analyze", "dispatch", "reinforce", "archive"}:
            if not isinstance(action.get("problemId"), str) or len(action["problemId"]) > 80:
                return False
        if kind == "dispatch" and (not isinstance(action.get("team"), str) or action.get("team") not in VALID_TEAMS):
            return False
        if kind == "mobility" and (not isinstance(action.get("key"), str) or action.get("key") not in VALID_MOBILITY_KEYS):
            return False
        if kind == "repair" and (not isinstance(action.get("puzzle"), str) or action.get("puzzle") not in VALID_PUZZLES):
            return False
        return True
    return False


def role_can_send_action(role: int, action: dict[str, Any]) -> bool:
    kind = action.get("kind")
    if kind == "interact":
        return True
    if kind == "mobility":
        return role == 2
    if kind == "repair":
        return role == 1
    return role == 3


async def handle_message(websocket: ServerConnection, message: dict[str, Any]) -> None:
    room_player = connections.get(websocket)
    kind = message.get("type")
    if kind == "ping":
        await send_json(websocket, {"type": "pong", "clientTime": message.get("clientTime"), "serverTime": now_ms()})
        return
    if room_player is None:
        await handle_admission(websocket, message)
        return

    room, player_id = room_player
    player = room.players.get(player_id)
    if player is None:
        return

    if kind == "choose_role":
        role = message.get("role")
        if room.status != "lobby" or not valid_role(role):
            await fail(websocket, "O personagem não pode ser trocado agora.")
            return
        if not free_role(room, role) and player.role != role:
            await fail(websocket, "Esse personagem já foi escolhido. Selecione outro.")
            return
        player.role = role
        player.ready = False
        await broadcast_room(room)
    elif kind == "ready":
        if room.status != "lobby":
            await fail(websocket, "A sala já está iniciando.")
            return
        player.ready = bool(message.get("ready"))
        await broadcast_room(room)
    elif kind == "start":
        if player_id != room.host_id:
            await fail(websocket, "Somente quem criou a sala pode iniciar.")
            return
        if room.status != "lobby":
            return
        if not room.players or not all(member.ready for member in room.players.values()):
            await fail(websocket, "Todos os jogadores conectados precisam estar prontos.")
            return
        room.status = "countdown"
        room.start_at = now_ms() + COUNTDOWN_MS
        await broadcast_room(room)

        async def begin() -> None:
            await asyncio.sleep(COUNTDOWN_MS / 1000)
            if rooms.get(room.code) is not room or room.status != "countdown":
                return
            room.status = "running"
            await broadcast_room(room)

        room.countdown_task = asyncio.create_task(begin())
    elif kind == "player_state":
        if not game_has_started(room):
            return
        state = message.get("state")
        if not isinstance(state, dict):
            return
        values = [state.get("x"), state.get("z"), state.get("rotation")]
        if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in values):
            return
        x, z, rotation = values
        if abs(x) > 60 or abs(z) > 60 or abs(rotation) > math.tau * 4:
            return
        await broadcast(room, {"type": "player_state", "playerId": player_id, "role": player.role,
            "state": {"x": x, "z": z, "rotation": rotation}})
    elif kind == "action":
        action = message.get("action")
        if not game_has_started(room) or not valid_action(action) or not role_can_send_action(player.role, action):
            return
        await broadcast(room, {"type": "action", "playerId": player_id, "role": player.role,
            "action": action})
    elif kind == "pause":
        if not game_has_started(room) or not isinstance(message.get("paused"), bool):
            return
        await broadcast(room, {"type": "pause", "playerId": player_id, "role": player.role,
            "paused": message["paused"]})
    elif kind == "leave":
        await websocket.close()


async def handler(websocket: ServerConnection) -> None:
    send_locks[websocket] = asyncio.Lock()
    try:
        async for raw in websocket:
            if len(raw) > 32_768:
                await fail(websocket, "Mensagem grande demais.")
                continue
            try:
                message = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                await fail(websocket, "Mensagem inválida.")
                continue
            if isinstance(message, dict):
                await handle_message(websocket, message)
    finally:
        send_locks.pop(websocket, None)
        room_player = connections.pop(websocket, None)
        if room_player:
            room, player_id = room_player
            room.players.pop(player_id, None)
            if room.countdown_task and not room.countdown_task.done():
                room.countdown_task.cancel()
                room.countdown_task = None
            if room.status == "countdown":
                room.status = "lobby"
                room.start_at = None
            if not room.players:
                rooms.pop(room.code, None)
            else:
                if room.host_id == player_id:
                    room.host_id = next(iter(room.players))
                await broadcast_room(room)


async def main() -> None:
    print(f"Suburban coop WebSocket ouvindo em ws://0.0.0.0:{PORT}")
    async with serve(handler, "0.0.0.0", PORT, ping_interval=20, ping_timeout=20, max_size=32_768):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Servidor coop encerrado.")
