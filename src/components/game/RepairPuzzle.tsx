'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RepairPuzzleType } from '@/game/session/repairPuzzleTypes';

type Direction = 0 | 1 | 2 | 3;
type WireTile = { id: string; row: number; column: number; kind: 'straight' | 'corner'; rotation: number };
type Point = { row: number; column: number };

const SOURCE: Point = { row: 2, column: 0 };
const LAMP: Point = { row: 0, column: 3 };
const DELTAS: Record<Direction, Point> = {
  0: { row: -1, column: 0 },
  1: { row: 0, column: 1 },
  2: { row: 1, column: 0 },
  3: { row: 0, column: -1 },
};
const BASE_PORTS: Record<WireTile['kind'], Direction[]> = {
  straight: [0, 2],
  corner: [0, 1],
};
const INITIAL_TILES: WireTile[] = [
  { id: 'wire-a', row: 2, column: 1, kind: 'straight', rotation: 0 },
  { id: 'wire-b', row: 2, column: 2, kind: 'corner', rotation: 1 },
  { id: 'wire-c', row: 1, column: 2, kind: 'corner', rotation: 3 },
  { id: 'wire-d', row: 1, column: 3, kind: 'corner', rotation: 0 },
];
const rotateDirection = (direction: Direction, rotation: number): Direction => ((direction + rotation) % 4) as Direction;
const opposite = (direction: Direction): Direction => ((direction + 2) % 4) as Direction;
const pointKey = (point: Point) => `${point.row},${point.column}`;

function ports(tile: WireTile): Direction[] {
  return BASE_PORTS[tile.kind].map(direction => rotateDirection(direction, tile.rotation));
}

function tracePower(tiles: WireTile[]): { powered: Set<string>; lampOn: boolean } {
  const byPosition = new Map(tiles.map(tile => [pointKey(tile), tile]));
  const powered = new Set<string>();
  const queue: Array<{ point: Point; incoming: Direction }> = [{ point: { row: 2, column: 1 }, incoming: 3 }];
  const visited = new Set<string>();
  let lampOn = false;

  while (queue.length) {
    const { point, incoming } = queue.shift()!;
    const tile = byPosition.get(pointKey(point));
    if (!tile) continue;
    const visitKey = `${tile.id}:${incoming}`;
    if (visited.has(visitKey) || !ports(tile).includes(incoming)) continue;
    visited.add(visitKey);
    powered.add(tile.id);
    for (const exit of ports(tile)) {
      if (exit === incoming) continue;
      const delta = DELTAS[exit];
      const next = { row: point.row + delta.row, column: point.column + delta.column };
      if (pointKey(next) === pointKey(LAMP)) {
        if (exit === 0) lampOn = true;
        continue;
      }
      if (next.row < 0 || next.row >= 4 || next.column < 0 || next.column >= 4) continue;
      queue.push({ point: next, incoming: opposite(exit) });
    }
  }
  return { powered, lampOn };
}

function WireGraphic({ tile, powered }: { tile: WireTile; powered: boolean }) {
  const path = tile.kind === 'straight' ? 'M32 5V59' : 'M32 5V32H59';
  return <svg className={`circuit-wire${powered ? ' is-powered' : ''}`} viewBox="0 0 64 64" aria-hidden="true">
    <g transform={`rotate(${tile.rotation * 90} 32 32)`}>
      <path className="wire-shadow" d={path} />
      <path className="wire-track" d={path} />
      <path className="wire-core" d={path} />
      <circle className="wire-joint" cx="32" cy="32" r="5" />
    </g>
  </svg>;
}

const SIGNAL_CABLES = [
  { id: 'red', label: 'ALERTA', color: '#ff625d', symbol: '△' },
  { id: 'blue', label: 'CONTROLE', color: '#58adff', symbol: '✕' },
  { id: 'yellow', label: 'ENERGIA', color: '#ffd24f', symbol: '○' },
  { id: 'magenta', label: 'SINCRONIA', color: '#ed70d9', symbol: '✦' },
] as const;
type SignalCableId = typeof SIGNAL_CABLES[number]['id'];
const SIGNAL_RIGHT_ORDER = ['yellow', 'magenta', 'red', 'blue'] as const;
const SIGNAL_ROWS = [74, 150, 226, 302];

function SignalRepairPuzzle({ paused, onComplete, onCancel }: { paused: boolean; onComplete: () => void; onCancel?: () => void }) {
  const [connections, setConnections] = useState<Record<string, string>>({});
  const [selectedCable, setSelectedCable] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [errorTerminals, setErrorTerminals] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  const [message, setMessage] = useState('Selecione um cabo à esquerda e conecte o terminal com a mesma cor e símbolo.');
  const completion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cableById = new Map(SIGNAL_CABLES.map(cable => [cable.id, cable]));

  useEffect(() => () => {
    if (completion.current) clearTimeout(completion.current);
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  const connect = (targetId: string) => {
    if (paused || solved || !selectedCable) return;
    if (selectedCable !== targetId) {
      setError(true);
      setErrorTerminals([selectedCable, targetId]);
      setMessage('Conexão incompatível. Confira a cor e o símbolo dos terminais.');
      setSelectedCable(null);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => { setError(false); setErrorTerminals([]); }, 650);
      return;
    }
    const next = { ...connections, [selectedCable]: targetId };
    setConnections(next);
    setSelectedCable(null);
    setMessage('Conexão confirmada. Continue com os cabos restantes.');
    if (Object.keys(next).length === SIGNAL_CABLES.length) {
      setSolved(true);
      setMessage('TODOS OS CIRCUITOS RESTABELECIDOS · SEMÁFORO OPERACIONAL');
      completion.current = setTimeout(onComplete, 1100);
    }
  };

  const selectSource = (id: string) => {
    if (paused || solved) return;
    if (connections[id]) {
      const next = { ...connections };
      delete next[id];
      setConnections(next);
    }
    setSelectedCable(id);
    setMessage('Agora selecione o terminal correspondente à direita.');
  };

  const terminal = (id: SignalCableId, y: number, side: 'left' | 'right') => {
    const cable = cableById.get(id)!;
    const x = side === 'left' ? 60 : 580;
    const connected = !!connections[id];
    const active = selectedCable === id;
    const buttonProps = side === 'left'
      ? { onClick: () => selectSource(id) }
      : { onClick: () => connect(id) };
    return <g key={`${side}-${id}`} className={`signal-terminal ${active ? 'is-selected' : ''}${error && errorTerminals.includes(id) ? ' is-error' : ''}${connected ? ' is-connected' : ''}`}
      role="button" tabIndex={paused || solved ? -1 : 0}
      aria-label={`${side === 'left' ? 'Cabo' : 'Terminal'} ${cable.label}, símbolo ${cable.symbol}${connected ? ', conectado' : ''}`}
      onClick={buttonProps.onClick}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); buttonProps.onClick(); } }}>
      <circle className="signal-terminal-hit" cx={x} cy={y} r="30" />
      <path className="signal-terminal-metal" d={`M${x - 19} ${y - 13}h38l7 13-7 13h-38l-7-13z`} />
      <path className="signal-terminal-face" d={`M${x - 12} ${y - 9}h24l5 9-5 9h-24l-5-9z`} style={{ fill: cable.color }} />
      <text x={x} y={y + 6} className="signal-terminal-symbol">{cable.symbol}</text>
      <circle className="signal-terminal-pin" cx={side === 'left' ? x + 25 : x - 25} cy={y} r="5" />
    </g>;
  };

  return <div className="repair-puzzle-overlay signal-repair-overlay" style={paused ? { display: 'none' } : undefined} role="dialog" aria-modal="true" aria-labelledby="signal-repair-title">
    <section className={`repair-puzzle-card signal-repair-card${solved ? ' is-solved' : ''}`}>
      <header className="repair-puzzle-header signal-repair-header">
        <span className="repair-puzzle-kicker">MANUTENÇÃO DE CAMPO · CONTROLE VIÁRIO</span>
        <span className="repair-puzzle-chip">SEMÁFORO 02</span>
        {onCancel && <button type="button" className="repair-puzzle-cancel" onClick={onCancel}>Voltar aos testes</button>}
        <h2 id="signal-repair-title">RESTABELEÇA OS CIRCUITOS</h2>
        <p>Reconecte os cabos identificados para sincronizar as luzes do cruzamento.</p>
      </header>
      <div className="signal-board-frame">
        <div className="signal-board-labels"><span>ENTRADAS</span><span>CONTROLADOR</span><span>SAÍDAS</span></div>
        <svg className="signal-cable-board" viewBox="0 0 640 376" role="group" aria-label="Painel de cabos desconectados do semáforo">
          <defs>
            <linearGradient id="signal-metal" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f2d991" /><stop offset=".45" stopColor="#918765" /><stop offset="1" stopColor="#344a4d" /></linearGradient>
            <linearGradient id="signal-panel" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#315962" /><stop offset=".5" stopColor="#183746" /><stop offset="1" stopColor="#24434b" /></linearGradient>
          </defs>
          <rect x="10" y="10" width="620" height="356" rx="18" className="signal-board-shell" />
          <rect x="185" y="28" width="270" height="320" rx="14" className="signal-controller" />
          <path d="M320 42v292" className="signal-controller-seam" />
          {[34, 606].map(x => SIGNAL_ROWS.map(y => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" className="signal-screw" />))}
          {SIGNAL_ROWS.map((leftY, index) => {
            const leftId = SIGNAL_CABLES[index].id;
            const rightId = SIGNAL_RIGHT_ORDER[index];
            const rightY = SIGNAL_ROWS[SIGNAL_RIGHT_ORDER.indexOf(leftId)];
            const connected = connections[leftId] === leftId;
            const color = SIGNAL_CABLES[index].color;
            const bend = (index - 1.5) * 9;
            const leftPath = connected ? `M86 ${leftY} C205 ${leftY + bend}, 425 ${rightY - bend}, 554 ${rightY}` : `M86 ${leftY} C185 ${leftY + bend}, 232 188, 277 188`;
            const rightPath = connected ? null : `M363 188 C408 188, 455 ${rightY - bend}, 554 ${rightY}`;
            return <g key={leftId} className={connected ? 'signal-wire is-connected' : 'signal-wire'}>
              <path d={leftPath} className="signal-wire-shadow" />
              <path d={leftPath} className="signal-wire-strand" style={{ stroke: color }} />
              {rightPath && <><path d={rightPath} className="signal-wire-shadow" /><path d={rightPath} className="signal-wire-strand" style={{ stroke: SIGNAL_CABLES.find(cable => cable.id === rightId)!.color }} /></>}
              {!connected && <><circle cx="277" cy="188" r="7" className="signal-wire-tip" /><circle cx="363" cy="188" r="7" className="signal-wire-tip" /></>}
            </g>;
          })}
          {SIGNAL_ROWS.map((y, index) => terminal(SIGNAL_CABLES[index].id, y, 'left'))}
          {SIGNAL_ROWS.map((y, index) => terminal(SIGNAL_RIGHT_ORDER[index], y, 'right'))}
          <circle cx="320" cy="188" r="21" className={`signal-status-light${solved ? ' is-on' : selectedCable ? ' is-active' : ''}`} />
          <path d="M313 188h14M320 181v14" className="signal-status-mark" />
        </svg>
      </div>
      <div className={`repair-puzzle-status signal-repair-status${error ? ' is-error' : ''}`} role="status" aria-live="polite"><i className={solved ? 'is-on' : ''} />{message}</div>
      <footer className="repair-puzzle-footer"><span>{Object.keys(connections).length}/{SIGNAL_CABLES.length} CONEXÕES FECHADAS</span><span>{solved ? 'SISTEMA OPERACIONAL' : 'PROTOCOLO DE SEMAFORIZAÇÃO'}</span></footer>
    </section>
  </div>;
}

type TrafficPiece = { id: string; row: number; column: number; kind: 'source' | 'destination' | 'straight' | 'curve'; rotation: number };
const TRAFFIC_INITIAL_PIECES: TrafficPiece[] = [
  { id: 'origin', row: 4, column: 0, kind: 'source', rotation: 0 },
  { id: 'road-a', row: 4, column: 1, kind: 'straight', rotation: 0 },
  { id: 'road-b', row: 4, column: 2, kind: 'curve', rotation: 0 },
  { id: 'road-c', row: 3, column: 2, kind: 'straight', rotation: 1 },
  { id: 'road-d', row: 2, column: 2, kind: 'curve', rotation: 0 },
  { id: 'road-e', row: 2, column: 1, kind: 'curve', rotation: 2 },
  { id: 'destination', row: 1, column: 1, kind: 'destination', rotation: 0 },
];
const TRAFFIC_DELTAS: Record<Direction, Point> = {
  0: { row: -1, column: 0 }, 1: { row: 0, column: 1 },
  2: { row: 1, column: 0 }, 3: { row: 0, column: -1 },
};

function trafficPorts(piece: TrafficPiece): Direction[] {
  if (piece.kind === 'source') return [1];
  if (piece.kind === 'destination') return [2];
  const base: Direction[] = piece.kind === 'straight' ? [0, 2] : [0, 1];
  return base.map(direction => rotateDirection(direction, piece.rotation));
}

function traceTrafficRoute(pieces: TrafficPiece[]): { path: string[]; complete: boolean } {
  const byCell = new Map(pieces.map(piece => [`${piece.row},${piece.column}`, piece]));
  const origin = pieces.find(piece => piece.kind === 'source');
  if (!origin) return { path: [], complete: false };
  const path: string[] = [origin.id];
  const visited = new Set<string>([origin.id]);
  let current = origin;
  let direction = trafficPorts(origin)[0];

  for (let step = 0; step < pieces.length; step++) {
    const delta = TRAFFIC_DELTAS[direction];
    const next = byCell.get(`${current.row + delta.row},${current.column + delta.column}`);
    if (!next || visited.has(next.id) || !trafficPorts(next).includes(opposite(direction))) return { path, complete: false };
    path.push(next.id);
    if (next.kind === 'destination') return { path, complete: path.length === pieces.length };
    visited.add(next.id);
    const exit = trafficPorts(next).find(port => port !== opposite(direction));
    if (exit === undefined) return { path, complete: false };
    current = next;
    direction = exit;
  }
  return { path, complete: false };
}

function TrafficTileGraphic({ piece, active }: { piece: TrafficPiece; active: boolean }) {
  const ports = trafficPorts(piece);
  const ends: Record<Direction, string> = {
    0: 'M50 50V4', 1: 'M50 50H96', 2: 'M50 50V96', 3: 'M50 50H4',
  };
  return <svg className={`flow-tile-graphic tile-${piece.kind}${active ? ' is-active' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
    {ports.map(port => <g key={port}><path d={ends[port]} className="flow-road-shadow" /><path d={ends[port]} className="flow-road-line" /><path d={ends[port]} className="flow-road-center" /></g>)}
    <circle cx="50" cy="50" r="13" className="flow-road-joint" />
    {piece.kind === 'source' && <text x="50" y="54" className="flow-terminal-label">IN</text>}
    {piece.kind === 'destination' && <text x="50" y="54" className="flow-terminal-label">OUT</text>}
    {piece.kind !== 'source' && piece.kind !== 'destination' && <g transform={`rotate(${piece.rotation * 90} 50 50)`}><path d="M50 35l-5 9h10z" className="flow-turn-indicator" /></g>}
  </svg>;
}

function TrafficFlowPuzzle({ paused, onComplete, onCancel }: { paused: boolean; onComplete: () => void; onCancel?: () => void }) {
  const [pieces, setPieces] = useState(TRAFFIC_INITIAL_PIECES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);
  const completion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const route = useMemo(() => traceTrafficRoute(pieces), [pieces]);

  useEffect(() => () => { if (completion.current) clearTimeout(completion.current); }, []);
  useEffect(() => {
    if (route.complete && !solved) {
      setSolved(true);
      completion.current = setTimeout(onComplete, 1000);
    }
  }, [route.complete, onComplete, solved]);

  const rotate = (id: string) => {
    if (paused || solved) return;
    setSelectedId(id);
    setPieces(current => current.map(piece => piece.id === id
      && piece.kind !== 'source' && piece.kind !== 'destination'
      ? { ...piece, rotation: (piece.rotation + 1) % 4 } : piece));
  };
  const pieceByCell = new Map(pieces.map(piece => [`${piece.row},${piece.column}`, piece]));
  const routeIds = new Set(route.path);
  const labels: Record<TrafficPiece['id'], string> = {
    origin: 'origem do fluxo', 'road-a': 'trecho reto A', 'road-b': 'curva B',
    'road-c': 'trecho reto C', 'road-d': 'curva D', 'road-e': 'curva E', destination: 'destino do fluxo',
  };

  return <div className="repair-puzzle-overlay" style={paused ? { display: 'none' } : undefined} role="dialog" aria-modal="true" aria-labelledby="traffic-flow-title">
    <section className={`repair-puzzle-card flow-repair-card${solved ? ' is-solved' : ''}`}>
      <header className="repair-puzzle-header flow-repair-header">
        <span className="repair-puzzle-kicker">CENTRAL DE OPERAÇÕES · MOBILIDADE URBANA</span>
        <span className="repair-puzzle-chip">VIAS 04</span>
        {onCancel && <button type="button" className="repair-puzzle-cancel" onClick={onCancel}>Voltar aos testes</button>}
        <h2 id="traffic-flow-title">RESTABELEÇA O FLUXO</h2>
        <p>Gire os trechos para conectar a origem à saída sem interrupções.</p>
      </header>
      <div className="flow-board-wrap">
        <div className="flow-board-legend"><span><i className="flow-legend-origin" /> ORIGEM</span><span><i className="flow-legend-route" /> ROTA ATIVA</span><span><i className="flow-legend-destination" /> DESTINO</span></div>
        <div className="flow-board" role="group" aria-label="Grade de vias. Gire os trechos para formar uma rota contínua.">
          {Array.from({ length: 25 }, (_, index) => {
            const row = Math.floor(index / 5), column = index % 5;
            const piece = pieceByCell.get(`${row},${column}`);
            if (!piece) return <div key={index} className="flow-cell flow-cell-empty" aria-hidden="true"><span /></div>;
            const fixed = piece.kind === 'source' || piece.kind === 'destination';
            return <button key={index} type="button" className={`flow-cell${fixed ? ' is-terminal' : ' is-rotatable'}${routeIds.has(piece.id) ? ' is-on-route' : ''}${selectedId === piece.id ? ' is-selected' : ''}${solved ? ' is-solved' : ''}`}
              onClick={() => rotate(piece.id)} disabled={paused || solved || fixed}
              aria-label={`${labels[piece.id]}, ${fixed ? 'ponto fixo' : 'girar trecho'}`}>
              <TrafficTileGraphic piece={piece} active={routeIds.has(piece.id)} />
            </button>;
          })}
        </div>
      </div>
      <div className={`repair-puzzle-status flow-repair-status${solved ? ' is-on' : ''}`} role="status" aria-live="polite">
        <i className={solved ? 'is-on' : ''} />{solved ? 'ROTA VALIDADA · FLUXO RESTABELECIDO' : route.path.length > 1 ? `Rota conectada parcialmente · ${route.path.length - 1}/6 trechos. Gire as peças destacadas até a saída.` : 'Rota interrompida. Gire os trechos disponíveis para alcançar a saída.'}
      </div>
      <footer className="repair-puzzle-footer"><span>{solved ? 'SISTEMA OPERACIONAL' : `${Math.max(0, route.path.length - 1)}/6 TRECHOS CONECTADOS`}</span><span>ROTA DE ESCOAMENTO · VIA DE ESCAPE</span></footer>
    </section>
  </div>;
}

function DifferentRepairPuzzle({ type, paused, onComplete, onCancel }: { type: Exclude<RepairPuzzleType, 'pole'>; paused: boolean; onComplete: () => void; onCancel?: () => void }) {
  const [values, setValues] = useState<number[]>(type === 'signal' ? [0, 2, 1] : type === 'traffic' ? [0, 1, 0, 1] : []);
  const [sequenceStep, setSequenceStep] = useState(-1);
  const [solved, setSolved] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const complete = () => { setSolved(true); setMessage('REPARO CONCLUÍDO · SISTEMA RESTABELECIDO'); timer.current = setTimeout(onComplete, 850); };
  const specs = {
    signal: ['SEMÁFORO 02', 'SINCRONIZE AS LUZES', 'Toque nas lâmpadas até formar a sequência segura: vermelho, amarelo, verde.'],
    crossing: ['FAIXA 03', 'LIBERE A TRAVESSIA', 'Toque nos pontos na ordem indicada para programar a travessia segura.'],
    traffic: ['VIAS 04', 'REORGANIZE O FLUXO', 'Gire as placas para conectar a entrada à saída pela rota de escape.'],
    sensor: ['SENSOR 05', 'CALIBRE O SENSOR', 'Observe a sequência de sinais e repita tocando nos módulos.'],
    car: ['VEÍCULO 06', 'RECONECTE O VEÍCULO', 'Ligue os cabos na ordem correta para liberar o carro da faixa.'],
  }[type];
  const click = (index: number) => {
    if (paused || solved) return;
    if (type === 'signal') {
      const next = values.map((value, i) => i === index ? (value + 1) % 3 : value); setValues(next);
      if (next.every((value, i) => value === i)) complete();
    } else if (type === 'traffic') {
      const next = values.map((value, i) => i === index ? (value + 1) % 2 : value); setValues(next);
      if (next.join('') === '1010') complete();
    } else if (type === 'crossing' || type === 'car') {
      const nextIndex = values.length;
      if (index === nextIndex) { const next = [...values, index]; setValues(next); if (next.length === 3) complete(); }
      else { setValues([]); setMessage('Ordem incorreta. Tente novamente seguindo 1, 2 e 3.'); }
    } else {
      const expected = [2, 0, 3][sequenceStep + 1];
      if (index !== expected) { setSequenceStep(-1); setMessage('Sinal incorreto. Repita a sequência: módulo 3, 1, 4.'); return; }
      if (sequenceStep === 1) complete(); else setSequenceStep(sequenceStep + 1);
    }
  };
  const names = type === 'signal' ? ['VERMELHO', 'AMARELO', 'VERDE'] : type === 'crossing' ? ['CALÇADA', 'FAIXA', 'REFÚGIO'] : type === 'sensor' ? ['MÓDULO 1', 'MÓDULO 2', 'MÓDULO 3', 'MÓDULO 4'] : type === 'car' ? ['TERMINAL 1', 'TERMINAL 2', 'TERMINAL 3'] : ['VIA 1', 'VIA 2', 'VIA 3', 'VIA 4'];
  const count = names.length;
  return <div className="repair-puzzle-overlay" style={paused ? { display: 'none' } : undefined} role="dialog" aria-modal="true">
    <section className={`repair-puzzle-card${solved ? ' is-solved' : ''}`}>
      <header className="repair-puzzle-header"><span className="repair-puzzle-kicker">OFICINA DE CAMPO · CENTRAL DE OPERAÇÕES</span><span className="repair-puzzle-chip">{specs[0]}</span>{onCancel && <button type="button" className="repair-puzzle-cancel" onClick={onCancel}>Voltar aos testes</button>}<h2>{specs[1]}</h2><p>{specs[2]}</p></header>
      <div className={`repair-variant-board variant-${type}`}>
        {type === 'traffic' && <strong>ENTRADA</strong>}
        {Array.from({ length: count }, (_, i) => <button key={i} type="button" disabled={paused || solved} onClick={() => click(i)} className={`repair-variant-node${(type === 'crossing' || type === 'car') && values.includes(i) || type === 'sensor' && sequenceStep === i ? ' is-powered' : ''}${type === 'signal' ? ` signal-${['red','yellow','green'][values[i]]}` : ''}`}><span>{type === 'signal' ? '●' : type === 'crossing' ? values.includes(i) ? '✓' : i + 1 : type === 'traffic' ? values[i] ? '↘' : '↗' : type === 'sensor' ? ['◈','⌁','⌖','◉'][i] : values.includes(i) ? '✓' : '＋'}</span><small>{type === 'signal' ? ['VERMELHO','AMARELO','VERDE'][values[i]] : names[i]}</small></button>)}
        {type === 'traffic' && <strong>SAÍDA</strong>}
      </div>
      <div className="repair-puzzle-status" role="status"><i className={solved ? 'is-on' : ''} />{message || (type === 'sensor' ? 'Memorize e repita: módulo 3, 1, 4.' : type === 'traffic' ? 'Ajuste as quatro placas até fechar a rota.' : type === 'signal' ? 'Estado atual das três lâmpadas.' : 'Siga os números 1, 2 e 3.')}</div>
      <footer className="repair-puzzle-footer"><span>{solved ? 'SISTEMA OPERACIONAL' : `${type === 'crossing' || type === 'car' ? values.length : type === 'sensor' ? sequenceStep + 1 : '—'} / ${type === 'signal' ? '3 LUZES' : type === 'traffic' ? '4 VIAS' : type === 'sensor' ? '3 SINAIS' : '3 ETAPAS'}`}</span><span>PROTOCOLO DE REPARO</span></footer>
    </section>
  </div>;
}

export default function RepairPuzzle({ onComplete, paused = false, type = 'pole', onCancel }: { onComplete: () => void; paused?: boolean; type?: RepairPuzzleType; onCancel?: () => void }) {
  if (type === 'signal') return <SignalRepairPuzzle paused={paused} onComplete={onComplete} onCancel={onCancel} />;
  if (type === 'traffic') return <TrafficFlowPuzzle paused={paused} onComplete={onComplete} onCancel={onCancel} />;
  if (type !== 'pole') return <DifferentRepairPuzzle type={type} paused={paused} onComplete={onComplete} onCancel={onCancel} />;
  const [tiles, setTiles] = useState(INITIAL_TILES);
  const [solved, setSolved] = useState(false);
  const [hint, setHint] = useState('A energia não chega à luminária. Gire os conectores para fechar o circuito.');
  const completion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { powered, lampOn } = useMemo(() => tracePower(tiles), [tiles]);

  useEffect(() => () => { if (completion.current) clearTimeout(completion.current); }, []);
  useEffect(() => {
    if (lampOn && !solved) {
      setSolved(true);
      setHint('CIRCUITO RESTABELECIDO · LUMINÁRIA ACESA');
      completion.current = setTimeout(onComplete, 1100);
    }
  }, [lampOn, onComplete, solved]);

  const rotate = (id: string) => {
    if (paused || solved) return;
    setTiles(current => current.map(tile => tile.id === id ? { ...tile, rotation: (tile.rotation + 1) % 4 } : tile));
    setHint('Conexão ajustada. Siga o caminho da energia até a lâmpada.');
  };

  return <div style={paused ? { display: 'none' } : undefined} className="repair-puzzle-overlay" role="dialog" aria-modal="true" aria-labelledby="repair-puzzle-title">
    <section className={`repair-puzzle-card${solved ? ' is-solved' : ''}`}>
      <header className="repair-puzzle-header">
        <span className="repair-puzzle-kicker">OFICINA DE CAMPO · ELÉTRICA</span>
        <span className="repair-puzzle-chip">POSTE 01</span>
        {onCancel && <button type="button" className="repair-puzzle-cancel" onClick={onCancel}>Voltar aos testes</button>}
        <h2 id="repair-puzzle-title">RESTABELEÇA A ENERGIA</h2>
        <p>Gire os conectores e leve a corrente até a luminária.</p>
      </header>

      <div className={`circuit-board${lampOn ? ' lamp-is-on' : ''}`} aria-label="Tabuleiro de conexões elétricas">
        {Array.from({ length: 16 }, (_, index) => {
          const row = Math.floor(index / 4), column = index % 4;
          const tile = tiles.find(candidate => candidate.row === row && candidate.column === column);
          const isSource = row === SOURCE.row && column === SOURCE.column;
          const isLamp = row === LAMP.row && column === LAMP.column;
          if (isSource) return <div key={index} className="circuit-cell circuit-source" aria-label="Fonte de energia"><span>⚡</span><small>FONTE</small></div>;
          if (isLamp) return <div key={index} className={`circuit-cell circuit-lamp${lampOn ? ' is-on' : ''}`} aria-label={lampOn ? 'Luminária acesa' : 'Luminária apagada'}><span>✦</span><small>{lampOn ? 'ACESO' : 'LÂMPADA'}</small></div>;
          if (tile) return <button key={index} type="button" className={`circuit-cell circuit-tile${powered.has(tile.id) ? ' is-powered' : ''}`} onClick={() => rotate(tile.id)} aria-label={`Girar conexão ${tile.kind === 'corner' ? 'curva' : 'reta'}`} aria-pressed={powered.has(tile.id)} disabled={paused || solved}>
            <WireGraphic tile={tile} powered={powered.has(tile.id)} /><small>GIRAR</small>
          </button>;
          return <div key={index} className="circuit-cell circuit-empty" aria-hidden="true"><span>·</span></div>;
        })}
      </div>

      <div className="repair-puzzle-status" role="status"><i className={lampOn ? 'is-on' : ''} />{hint}</div>
      <footer className="repair-puzzle-footer"><span>{powered.size}/4 CONEXÕES ENERGIZADAS</span><button type="button" onClick={() => { if (!solved && !paused) { setTiles(INITIAL_TILES); setHint('Circuito reiniciado. Gire as peças para levar energia à luminária.'); } }} disabled={solved || paused}>REINICIAR CIRCUITO</button></footer>
    </section>
  </div>;
}
