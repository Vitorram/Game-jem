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

function DifferentRepairPuzzle({ type, paused, onComplete }: { type: Exclude<RepairPuzzleType, 'pole'>; paused: boolean; onComplete: () => void }) {
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
      <header className="repair-puzzle-header"><span className="repair-puzzle-kicker">OFICINA DE CAMPO · CENTRAL DE OPERAÇÕES</span><span className="repair-puzzle-chip">{specs[0]}</span><h2>{specs[1]}</h2><p>{specs[2]}</p></header>
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

export default function RepairPuzzle({ onComplete, paused = false, type = 'pole' }: { onComplete: () => void; paused?: boolean; type?: RepairPuzzleType }) {
  if (type !== 'pole') return <DifferentRepairPuzzle type={type} paused={paused} onComplete={onComplete} />;
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
