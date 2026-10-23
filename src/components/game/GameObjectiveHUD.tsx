'use client';

import { useEffect, useState } from 'react';
import { suburbanGameState, type RoadState } from '@/game/core/GameState';
import type { PlayerId } from '@/game/entities/Player';

function useWorld() {
  const [world, setWorld] = useState(() => suburbanGameState.snapshot());
  useEffect(() => {
    const timer = window.setInterval(() => setWorld(suburbanGameState.snapshot()), 300);
    return () => window.clearInterval(timer);
  }, []);
  return world;
}

function useRoads() {
  const [roads, setRoads] = useState<RoadState[]>(() => suburbanGameState.snapshot().roads);
  useEffect(() => {
    const timer = window.setInterval(() => setRoads(suburbanGameState.snapshot().roads), 350);
    return () => window.clearInterval(timer);
  }, []);
  return roads;
}

export default function GameObjectiveHUD({ player, distance, tutorialTarget = false }: { player: PlayerId; distance: number | null; tutorialTarget?: boolean }) {
  const world = useWorld();
  const problem = world.problems[0];
  const roads = useRoads();
  if (world.phase) {
    const crossing = world.problems.find(item => item.id === 'traffic-signal-failure');
    const returnToMobility = crossing?.instruction?.includes('Troque para Mobilidade');
    return returnToMobility && (player === 1 || player === 2)
      ? <div className="game-objective-hud phase-objective" role="status">
          <b>PRÓXIMA ETAPA · MOBILIDADE</b><span>{crossing?.instruction}</span>
        </div>
      : null;
  }
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
      <span>{infrastructure && mobility ? 'Equipes acionadas! Escolha Mobilidade e siga a seta.' : selected ? `1 INFRA ${infrastructure ? '✓' : ''} · 2 MOBILIDADE ${mobility ? '✓' : ''} · E ACIONAR PRÓXIMA` : 'E ou Acionar equipe para selecionar a ocorrência.'}</span>
    </div>;
  }

  const team = player === 1 ? 'infraestrutura' : 'mobilidade';
  const interventionsRemain = roads.some(road => road.conesActive
    || (road.type === 'PRINCIPAL' && road.status === 'blocked')
    || (road.type === 'GREEN' && road.redirected));
  if (problem.status === 'RESOLVED' && player === 1
    && problem.dispatchedTeams.includes('mobilidade') && interventionsRemain) {
    return <div className="game-objective-hud for-mobility" role="status">
      <b>REPARO CONCLUÍDO</b>
      <span>Troque para Mobilidade e use 1 para reabrir a via principal.</span>
    </div>;
  }
  if (problem.status === 'RESOLVED'
    && !(player === 2 && problem.dispatchedTeams.includes('mobilidade') && interventionsRemain)) return null;
  if (player === 2 && !problem.dispatchedTeams.includes(team)) return <div className="game-objective-hud for-mobility">
    <span>AGUARDANDO ACIONAMENTO DA ANALISTA</span>
  </div>;
  if (!problem.dispatchedTeams.includes(team)) return null;
  return <div className={`game-objective-hud ${player === 1 ? 'for-infrastructure' : 'for-mobility'}${tutorialTarget ? ' tutorial-focus' : ''}`} data-tutorial-target={tutorialTarget ? 'true' : undefined} role="status">
    <b>{problem.status === 'RESOLVED' ? 'OBJETIVO · NORMALIZAR FLUXO' : player === 1 ? 'OBJETIVO · POSTE' : 'OBJETIVO · FLUXO'} · SETOR 02 {distance === null ? '' : `· ~${distance} m`}</b>
    {player === 2 ? <span>{problem.status === 'RESOLVED' ? 'O reparo terminou. Recolha os cones com E e devolva-os ao baú para normalizar a via.' : 'Pegue um cone no baú com E e leve até a seta para proteger a via. Mantenha-o no local enquanto Infraestrutura repara o poste.'}</span> : <span>Chegue perto do poste. Com a área segura, use E para reparar; Espaço ou toque para alinhar os pinos.</span>}
  </div>;
}

