'use client';

import { useEffect, useState } from 'react';
import { suburbanGameState, type RoadState } from '@/game/core/GameState';

const names: Record<string, string> = {
  'orla-eastbound': 'Av. Principal · Leste',
  'orla-eastbound-2': 'Av. Principal · Leste 2',
  'orla-westbound': 'Av. Principal · Oeste',
  'orla-westbound-2': 'Av. Principal · Oeste 2',
  'orla-escape': 'Via de Escape',
};

export default function TrafficOverview() {
  const [roads, setRoads] = useState<RoadState[]>(() => suburbanGameState.snapshot().roads);
  useEffect(() => {
    const timer = window.setInterval(() => setRoads(suburbanGameState.snapshot().roads), 350);
    return () => window.clearInterval(timer);
  }, []);

  return <aside className="traffic-overview" aria-label="Análise do fluxo viário">
    <header><span>ANÁLISE DE FLUXO</span><b>AO VIVO</b></header>
    {roads.map(road => <div className="traffic-overview-road" key={road.id}>
      <div><b>{names[road.id] ?? road.id}</b><span className={road.status === 'blocked' ? 'is-blocked' : road.congestion >= 0.7 ? 'is-congested' : ''}>{road.status === 'blocked' ? 'BLOQUEADA' : road.status === 'stopped' ? 'PARADA' : road.congestion >= 0.7 ? 'CONGESTIONADA' : road.type === 'ESCAPE' ? road.redirected ? 'ATIVA' : 'FECHADA' : 'FLUINDO'}</span></div>
      <div className="traffic-overview-bar"><i style={{ width: `${Math.round(road.congestion * 100)}%` }} /></div>
      <small>{road.direction === 'NORMAL' ? '→' : '←'} {road.vehicleCount} veículos · congestionamento {Math.round(road.congestion * 100)}% · carga {Math.min(100, Math.round(road.vehicleCount * 12.5 / road.capacity * 100))}%/{road.capacity}</small>
    </div>)}
  </aside>;
}
