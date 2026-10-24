'use client';

import { useEffect, useRef, useState } from 'react';
import { PLAYER_APPEARANCES, type PlayerId } from '@/game/entities/Player';
import { CoopClient, defaultCoopUrl, type CoopEvent, type CoopRoom } from '@/game/network/CoopClient';
import styles from './CoopLobby.module.css';

const ROLES: { id: PlayerId; task: string }[] = [
  { id: 1, task: 'Repara postes, sensores e veículos.' },
  { id: 2, task: 'Controla vias, cones e travessias.' },
  { id: 3, task: 'Analisa chamados e coordena as equipes.' },
];

export default function CoopLobby({ onCancel, onStart }: {
  onCancel: () => void;
  onStart: (client: CoopClient, role: PlayerId, room: CoopRoom) => void;
}) {
  const clientRef = useRef<CoopClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const starting = useRef(false);
  const [room, setRoom] = useState<CoopRoom | null>(null);
  const [name, setName] = useState('Jogador');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<PlayerId>(1);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [, setClock] = useState(0);

  useEffect(() => () => { unsubscribeRef.current?.(); }, []);
  useEffect(() => {
    if (room?.status !== 'countdown') return;
    const timer = setInterval(() => setClock(value => value + 1), 250);
    return () => clearInterval(timer);
  }, [room?.status, room?.startAt]);

  const getClient = () => {
    if (clientRef.current) return clientRef.current;
    const client = new CoopClient(defaultCoopUrl());
    clientRef.current = client;
    unsubscribeRef.current = client.subscribe((event: CoopEvent) => {
      if (event.type === 'room') {
        setRoom(event.room);
        setError('');
        setWorking(false);
        const me = event.room.players.find(player => player.id === client.playerId);
        if (me) setRole(me.role);
      } else if (event.type === 'error') {
        setError(event.message);
        setWorking(false);
      } else if (event.type === 'closed') {
        setError('A conexão com a sala foi perdida. Volte ao menu e conecte novamente.');
        setRoom(null);
      } else if (event.type === 'start_game' && !starting.current) {
        const me = event.room.players.find(player => player.id === client.playerId);
        if (!me) return;
        starting.current = true;
        onStart(client, me.role, event.room);
      }
    });
    return client;
  };

  const create = async () => {
    setError(''); setWorking(true);
    try { await getClient().createRoom(name, role); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível criar a sala.'); setWorking(false); }
  };

  const join = async () => {
    setError(''); setWorking(true);
    try { await getClient().joinRoom(code, name, role); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível entrar na sala.'); setWorking(false); }
  };

  const cancel = () => {
    clientRef.current?.leave();
    onCancel();
  };

  const client = clientRef.current;
  const me = room?.players.find(player => player.id === client?.playerId);
  const allReady = !!room?.players.length && room.players.every(player => player.ready);
  const roleTaken = (id: PlayerId) => room?.players.some(player => player.role === id && player.id !== me?.id) ?? false;
  const countdown = room?.startAt ? Math.max(0, Math.ceil((room.startAt - (client?.getServerTime() ?? Date.now())) / 1000)) : 0;

  return <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="coop-title">
    <section className={styles.panel}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>SUBURBAN · COOP ONLINE</span><h1 id="coop-title">Monte sua equipe</h1>
          <p>Até 3 pessoas. Cada jogador controla um personagem; todos entram juntos na Orla.</p></div>
        <button className={styles.close} onClick={cancel} aria-label="Fechar sala">×</button>
      </header>

      <div className={styles.roles}>
        {ROLES.map(item => {
          const appearance = PLAYER_APPEARANCES[item.id];
          const occupant = room?.players.find(player => player.role === item.id);
          const mine = occupant?.id === client?.playerId;
          const selected = room ? me?.role === item.id : role === item.id;
          return <button key={item.id} type="button" className={styles.roleCard} data-selected={selected || undefined}
            disabled={room ? roleTaken(item.id) || room.status !== 'lobby' : false}
            onClick={() => {
              setRole(item.id);
              if (room && client) client.chooseRole(item.id);
            }}>
            <span className={styles.avatar} style={{ backgroundColor: appearance.shirt }} aria-hidden="true">
              <svg viewBox="0 0 64 64" focusable="false">
                <path d="M7 62c1-16 10-23 25-23s24 7 25 23" fill={appearance.shirt} />
                <ellipse cx="32" cy="29" rx="17" ry="20" fill={appearance.skin} />
                {item.id === 1 && <><path d="M15 25c-5-9 1-19 7-17 2-8 11-8 14-4 8-4 16 3 14 12 4 3 3 9 0 12l-4-7-5-8c-7 4-14 5-23 4z" fill={appearance.hair} /><circle cx="16" cy="17" r="6" fill={appearance.hair} /><circle cx="25" cy="10" r="6" fill={appearance.hair} /><circle cx="38" cy="9" r="7" fill={appearance.hair} /><circle cx="48" cy="15" r="6" fill={appearance.hair} /></>}
                {item.id === 2 && <><path d="M15 25c-2-13 5-21 17-21s19 8 17 21l-2 15-7 7-2-23-6-4c-3 4-8 6-16 5l-1 21-7-8z" fill={appearance.hair} /><path d="M14 14c5-8 25-11 36-1l3 6H11z" fill="#d8c3a1" /><path d="M13 19c10 1 24 0 36-5v5c-11 6-25 7-36 3z" fill="#bda883" /></>}
                {item.id === 3 && <><path d="M15 27c-3-15 5-23 18-23 12 0 18 9 16 23l-5-7c-9 2-16-1-22-5l-5 12z" fill={appearance.hair} /><path d="M36 8c6-5 15 0 14 8-5-1-10-3-14-8z" fill="#315fca" /></>}
                <circle cx="26" cy="30" r="1.6" fill="#28323a" /><circle cx="38" cy="30" r="1.6" fill="#28323a" />
                <path d="M28 37c2 2 6 2 8 0" fill="none" stroke="#8b5143" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M21 48c6 4 16 4 22 0l7 8H14z" fill={appearance.shirt} />
              </svg>
            </span>
            <span className={styles.roleText}><b>{appearance.name}</b><small>{item.task}</small>
              {room && <em>{occupant ? `${occupant.name}${mine ? ' · você' : ''}${occupant.ready ? ' · pronto' : ''}` : 'Aguardando jogador'}</em>}
            </span>
            {selected && <span className={styles.check} aria-label="Selecionado">✓</span>}
          </button>;
        })}
      </div>

      {!room ? <div className={styles.entry}>
        <label>Seu nome<input maxLength={20} value={name} onChange={event => setName(event.target.value)} /></label>
        <div className={styles.entryButtons}><button className={styles.primary} disabled={working} onClick={create}>{working ? 'Conectando…' : 'Criar sala'}</button>
          <div className={styles.join}><input aria-label="Código da sala" maxLength={5} placeholder="CÓDIGO" value={code} onChange={event => setCode(event.target.value.toUpperCase())} />
            <button disabled={working || code.trim().length < 5} onClick={join}>Entrar</button></div>
        </div>
        <p className={styles.note}>Para jogar online, o servidor WebSocket precisa estar ligado em <code>8765</code>.</p>
      </div> : <div className={styles.roomControls}>
        <div className={styles.roomCode}><span>CÓDIGO DA SALA</span><b>{room.code}</b><small>Compartilhe com seus amigos</small></div>
        {room.status === 'countdown' || room.status === 'running'
          ? <div className={styles.countdown} aria-live="polite">{room.status === 'running' ? 'PARTIDA SINCRONIZADA' : `COMEÇANDO EM ${countdown}…`}</div>
          : <div className={styles.waiting}>
            <span>{room.players.length}/3 conectados {room.players.length === 1 ? '· aguardando equipe' : '· todos prontos para começar?'}</span>
            <button className={me?.ready ? styles.secondary : styles.primary} onClick={() => client?.setReady(!me?.ready)}>
              {me?.ready ? 'Pronto ✓' : 'Estou pronto'}
            </button>
            {room.hostId === client?.playerId && <button className={styles.start} disabled={!allReady} onClick={() => client?.start()}>
              Iniciar junto · {room.players.length} {room.players.length === 1 ? 'jogador' : 'jogadores'}
            </button>}
          </div>}
      </div>}

      {error && <div className={styles.error} role="alert">{error}</div>}
      <footer className={styles.footer}><span>Após o início, cada personagem fica reservado ao seu jogador.</span>
        {room && room.status === 'lobby' && <button onClick={cancel}>Sair da sala</button>}
      </footer>
    </section>
  </div>;
}
