'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

export default function RepairPuzzle({ onComplete, paused = false }: { onComplete: () => void; paused?: boolean }) {
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
