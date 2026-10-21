'use client';

import { useEffect, useState } from 'react';
import { suburbanGameState, type ResponseTeam } from '@/game/core/GameState';

function useProblemSnapshot() {
  const [problem, setProblem] = useState(() => suburbanGameState.snapshot().problems.find(item => item.id === 'broken-light-pole-1'));
  useEffect(() => {
    const timer = window.setInterval(() => setProblem(suburbanGameState.snapshot().problems.find(item => item.id === 'broken-light-pole-1')), 300);
    return () => window.clearInterval(timer);
  }, []);
  return problem;
}

const teamNames: Record<ResponseTeam, string> = { infraestrutura: 'INFRAESTRUTURA', mobilidade: 'MOBILIDADE' };

export function AnalystDispatchPanel({ onDispatch }: { onDispatch: (team: ResponseTeam) => void }) {
  const problem = useProblemSnapshot();
  if (!problem) return null;
  const resolved = problem.status === 'RESOLVED';
  return <aside className={`dispatch-center${resolved ? ' is-resolved' : ''}`} aria-live="polite">
    <header><span>{resolved ? '✓ OCORRÊNCIA RESOLVIDA' : 'CENTRAL DE ANÁLISE'}</span><b>{resolved ? 'CONCLUÍDA' : 'DETECTADA'}</b></header>
    <strong>{resolved ? 'POSTE REPARADO' : '⚠ POSTE DANIFICADO'}</strong>
    <small>LOCAL: SETOR 02</small>
    {!resolved && <>
      <p>Confirme o acionamento das equipes para enviar cada objetivo ao mapa.</p>
      {(['infraestrutura', 'mobilidade'] as const).map(team => {
        const dispatched = problem.dispatchedTeams.includes(team);
        return <button key={team} className={dispatched ? 'is-dispatched' : ''} disabled={dispatched}
          onClick={() => onDispatch(team)}>
          <span>{team === 'infraestrutura' ? '🔧' : '🚦'} {teamNames[team]}</span>
          <b>{dispatched ? 'EQUIPE ACIONADA ✓' : 'ACIONAR EQUIPE'}</b>
        </button>;
      })}
    </>}
  </aside>;
}

export function TeamDispatchNotice({ team, distance }: { team: ResponseTeam; distance: number | null }) {
  const problem = useProblemSnapshot();
  if (!problem || problem.status === 'RESOLVED' || !problem.dispatchedTeams.includes(team)) return null;
  const isInfrastructure = team === 'infraestrutura';
  return <aside className={`team-dispatch-notice ${isInfrastructure ? 'for-infrastructure' : 'for-mobility'}`} aria-live="polite">
    <header><span>{isInfrastructure ? '🔧 NOVA OCORRÊNCIA' : '🚦 NOVA OCORRÊNCIA'}</span><b>EQUIPE ACIONADA</b></header>
    <strong>{isInfrastructure ? 'POSTE DANIFICADO' : 'FLUXO CRÍTICO'}</strong>
    <small>LOCAL: SETOR 02</small>
    <div className="team-objective-caption">
      <span>{isInfrastructure ? 'OBJETIVO' : 'REGIÃO DE INTERVENÇÃO'}</span>
      <b>{distance === null ? 'ALVO NO MAPA' : `~${distance} m`}</b>
    </div>
    {!isInfrastructure && <small className="team-objective-instruction">INTERVENÇÃO NECESSÁRIA</small>}
  </aside>;
}
