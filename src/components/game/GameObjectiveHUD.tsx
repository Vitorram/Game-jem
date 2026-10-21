'use client';

import { useEffect, useState } from 'react';
import { suburbanGameState, type RoadState } from '@/game/core/GameState';
import type { PlayerId } from '@/game/entities/Player';

function useProblem() {
  const [problem, setProblem] = useState(() => suburbanGameState.snapshot().problems[0]);
  useEffect(() => {
    const timer = window.setInterval(() => setProblem(suburbanGameState.snapshot().problems[0]), 300);
    return () => window.clearInterval(timer);
  }, []);
  return problem;
}

function useRoads() {
  const [roads, setRoads] = useState<RoadState[]>(() => suburbanGameState.snapshot().roads);
  useEffect(() => {
    const timer = window.setInterval(() => setRoads(suburbanGameState.snapshot().roads), 350);
    return () => window.clearInterval(timer);
  }, []);
  return roads;
}

export default function GameObjectiveHUD({ player, distance }: { player: PlayerId; distance: number | null }) {
  const problem = useProblem();
  const roads = useRoads();
  if (!problem) return null;

  if (player === 3) {
    if (problem.status === 'RESOLVED') return <div className="game-objective-hud is-complete" role="status">
      <b>✓ OCORRÊNCIA RESOLVIDA</b><span>POSTE DANIFICADO · STATUS: RESOLVIDO</span>
    </div>;
    const infrastructure = problem.dispatchedTeams.includes('infraestrutura');
    const mobility = problem.dispatchedTeams.includes('mobilidade');
    const congestion = Math.max(0, ...roads.filter(road => road.type === 'PRINCIPAL').map(road => road.congestion));
    const traffic = congestion >= 0.68 ? { icon: '🔴', label: 'FLUXO CRÍTICO', color: 'critical' }
      : congestion >= 0.32 ? { icon: '🟡', label: 'ATENÇÃO', color: 'attention' }
        : { icon: '🟢', label: 'FLUXO NORMAL', color: 'normal' };
    const selected = suburbanGameState.snapshot().selectedProblemId === problem.id;
    return <div className="game-objective-hud" role="status">
      <b className={`traffic-state ${traffic.color}`}>{traffic.icon} {traffic.label}</b>
      <b>⚠ POSTE DANIFICADO · SETOR 02</b>
      <span>{selected ? `1 ACIONAR INFRA ${infrastructure ? '✓' : ''} · 2 ACIONAR MOBILIDADE ${mobility ? '✓' : ''} · E PRÓXIMA` : 'E SELECIONAR OCORRÊNCIA'}</span>
    </div>;
  }

  const team = player === 1 ? 'infraestrutura' : 'mobilidade';
  const interventionsRemain = roads.some(road => road.conesActive
    || (road.type === 'PRINCIPAL' && (road.status === 'blocked' || road.direction === 'REVERSE'))
    || (road.type === 'ESCAPE' && road.redirected));
  if (problem.status === 'RESOLVED'
    && !(player === 2 && problem.dispatchedTeams.includes('mobilidade') && interventionsRemain)) return null;
  if (player === 2 && !problem.dispatchedTeams.includes(team)) return <div className="game-objective-hud for-mobility">
    <span>AGUARDANDO ACIONAMENTO DA ANALISTA</span>
  </div>;
  if (!problem.dispatchedTeams.includes(team)) return null;
  return <div className={`game-objective-hud ${player === 1 ? 'for-infrastructure' : 'for-mobility'}`} role="status">
    <b>{problem.status === 'RESOLVED' ? 'OBJETIVO · NORMALIZAR FLUXO' : player === 1 ? 'OBJETIVO · POSTE' : 'OBJETIVO · FLUXO'} · SETOR 02 {distance === null ? '' : `· ~${distance} m`}</b>
    {player === 2 && <span>1–5 AÇÕES NA VIA · E COLOCAR / REMOVER CONE</span>}
  </div>;
}
