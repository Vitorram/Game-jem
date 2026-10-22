'use client';

import { useEffect, useMemo, useState } from 'react';
import { ORLA_MAP } from '@/game/map/orlaMap';
import { GRID_CONFIG } from '@/game/config';
import { suburbanGameState, type ResponseTeam, type UrbanProblem } from '@/game/core/GameState';

const tiles: Record<string, string> = { '~': 'sea', '.': 'sand', '=': 'prom', '-': 'cycle', R: 'road', '#': 'wall', B: 'counter', E: 'station', C: 'box' };
const teams: { id: ResponseTeam; label: string; short: string; color: string }[] = [
  { id: 'infraestrutura', label: 'Infraestrutura', short: 'REPARO ELÉTRICO', color: 'mint' },
  { id: 'mobilidade', label: 'Mobilidade', short: 'ISOLAR O TRECHO', color: 'gold' },
];

function problemTitle(problem: UrbanProblem): string {
  return problem.type === 'broken-light-pole' ? 'Poste danificado' : `${problem.label} · ocorrência`;
}

function problemCategory(problem: UrbanProblem): string {
  return problem.type === 'broken-light-pole' ? 'ILUMINAÇÃO' : 'SERVIÇO URBANO';
}

export default function OrlaTablet({ onAction }: { onAction: () => void }) {
  const [, refresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => refresh(value => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  const state = suburbanGameState.snapshot();
  const problems = state.problems;
  const selected = selectedId !== null;
  const issue = problems.find(problem => problem.id === selectedId)
    ?? problems.find(problem => problem.id === state.selectedProblemId)
    ?? problems.find(problem => problem.status !== 'RESOLVED')
    ?? problems[0];
  const selectedInGame = issue?.id === state.selectedProblemId;
  const nextTeam = teams.find(team => !issue?.dispatchedTeams.includes(team.id));
  const resolved = !issue || issue.status === 'RESOLVED';
  const activeCount = problems.filter(problem => problem.status !== 'RESOLVED').length;
  const actionLabel = resolved ? 'OCORRÊNCIA RESOLVIDA' : !selected ? 'SELECIONE UMA OCORRÊNCIA' : !selectedInGame ? 'CONFIRMAR OCORRÊNCIA' : nextTeam ? `ACIONAR ${nextTeam.label.toLocaleUpperCase('pt-BR')}` : 'EQUIPES ACIONADAS';

  const issueByTile = useMemo(() => {
    const columns = ORLA_MAP.rows[0].length;
    const rows = ORLA_MAP.rows.length;
    const width = columns * GRID_CONFIG.tileSize;
    const depth = rows * GRID_CONFIG.tileSize;
    const result = new Map<string, UrbanProblem[]>();
    for (const problem of problems) {
      const column = Math.floor((problem.position.x + width / 2) / GRID_CONFIG.tileSize);
      const row = Math.floor((problem.position.z + depth / 2) / GRID_CONFIG.tileSize);
      if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
      const key = `${row},${column}`;
      result.set(key, [...(result.get(key) ?? []), problem]);
    }
    return result;
  }, [problems]);

  return <section className="orla-tablet" aria-label="Tablet de análise da Analista">
    <div className="tablet-shell">
      <header className="tablet-topline">
        <div className="tablet-brand"><span className="tablet-logo">S</span><span>SUBURBAN <small>TERMINAL DE CAMPO</small></span></div>
        <div className="tablet-live"><i /> ORLA · AO VIVO</div>
        <span className="tablet-battery" aria-label="Bateria cheia"><i /><i /><i /><i /></span>
      </header>
      <div className="tablet-content">
        <div className="tablet-map-column">
          <div className="tablet-section-title"><span>01 / MAPA DA ÁREA</span><b>SETOR ORLA</b></div>
          <div className="tablet-map-frame">
            <div className="tablet-map" role="grid" aria-label="Mini mapa da Orla">
              {ORLA_MAP.rows.flatMap((row, rowIndex) => Array.from(row, (kind, column) => {
                const issues = issueByTile.get(`${rowIndex},${column}`) ?? [];
                const tileClass = kind === '-' && rowIndex === 7 ? 'sidewalk' : tiles[kind] ?? 'sand';
                return <div key={`${rowIndex}-${column}`} role="gridcell" className={`map-tile map-row-${rowIndex} map-col-${column} ${tileClass}${issues.length ? ' has-incident' : ''}`}>
                  {issues.length > 0 && <button aria-label={`Ver ${issues.length > 1 ? `${issues.length} ocorrências` : problemTitle(issues[0])}`} onClick={() => setSelectedId(issues[0].id)}>
                    <span className={`tablet-map-pin${selectedId === issues[0].id ? ' is-selected' : ''}${issues[0].status === 'RESOLVED' ? ' is-resolved' : ''}`}><i>{issues.length > 1 ? issues.length : '!'}</i></span>
                  </button>}
                  {!issues.length && ['B', 'C', 'E'].includes(kind) && <span className={`map-object object-${kind.toLowerCase()}`}>{kind === 'B' ? '▰' : kind === 'C' ? '□' : '⌂'}</span>}
                </div>;
              }))}
              <span className="map-crossing cycle-crossing" aria-hidden="true" />
              <span className="map-crossing tactile-cycle-edge" aria-hidden="true" />
              <span className="map-crossing north-curb-ramp" aria-hidden="true" />
              <span className="map-crossing road-crossing" aria-hidden="true" />
            </div>
            <div className="tablet-map-compass">N <i>▲</i></div>
            <div className="tablet-map-scale"><i /> 40 m</div>
          </div>
          <div className="tablet-map-legend"><span><i className="legend-sea" /> MAR</span><span><i className="legend-green" /> CALÇADÃO</span><span><i className="legend-cycle" /> CICLOVIA</span><span><i className="legend-road" /> AVENIDA</span><span><i className="legend-alert">!</i> ALERTA</span></div>
          <div className="tablet-map-callout"><span className="callout-dot" /> {String(activeCount).padStart(2, '0')} {activeCount === 1 ? 'OCORRÊNCIA ATIVA' : 'OCORRÊNCIAS ATIVAS'}</div>
        </div>

        <div className="tablet-incident-column">
          <div className="tablet-section-title"><span>02 / CENTRAL DE OCORRÊNCIAS</span><b className="active-tag"><i /> {activeCount} ATIVA{activeCount === 1 ? '' : 'S'}</b></div>
          <div className="tablet-incident-list" role="list" aria-label="Lista de ocorrências">
            {problems.map(problem => <button key={problem.id} role="listitem" className={`tablet-incident-card${selectedId === problem.id ? ' is-selected' : ''}${problem.status === 'RESOLVED' ? ' is-resolved' : ''}`} onClick={() => setSelectedId(problem.id)}>
              <span className="incident-icon">{problem.type === 'broken-light-pole' ? 'ϟ' : '!'}</span>
              <span className="incident-card-copy"><small>{problemCategory(problem)} · {problem.status === 'RESOLVED' ? 'RESOLVIDA' : problem.status === 'MAINTENANCE' ? 'EM ATENDIMENTO' : 'ATENÇÃO'}</small><b>{problemTitle(problem)}</b><em>{problem.type === 'broken-light-pole' ? 'Av. da Orla' : 'Setor Orla'} · {problem.dispatchedTeams.length}/2 equipes</em></span>
              <span className="incident-chevron">›</span>
            </button>)}
            {!problems.length && <div className="tablet-empty-list">Nenhuma ocorrência registrada.</div>}
          </div>
          <div className={`tablet-detail-card${!selected || !issue ? ' is-unselected' : ''}`}>
            <div className="tablet-detail-heading"><span className="detail-alert">!</span><div><small>RELATÓRIO DE CAMPO</small><b>{selected && issue ? problemTitle(issue) : 'Selecione uma ocorrência'}</b></div></div>
            <p>{selected && issue ? issue.type === 'broken-light-pole'
              ? 'A luminária está apagada e a estrutura do poste foi comprometida. Proteja o trecho antes do reparo elétrico.'
              : 'Ocorrência registrada no mapa. Analise o local e escolha as equipes adequadas para o atendimento.'
              : 'Escolha um alerta na lista ou no mapa para abrir os detalhes e preparar o atendimento.'}</p>
            {selected && issue && <div className="detail-tags"><span>{issue.status === 'RESOLVED' ? 'RESOLVIDA' : 'RISCO EM ANÁLISE'}</span><span>{issue.dispatchedTeams.length}/2 EQUIPES ACIONADAS</span></div>}
          </div>
          <div className="tablet-team-title"><span>PLANO DE RESPOSTA</span><small>{issue?.dispatchedTeams.length ?? 0}/2 EQUIPES</small></div>
          <div className="tablet-teams">
            {teams.map(team => {
              const dispatched = issue?.dispatchedTeams.includes(team.id) ?? false;
              return <div className={`tablet-team ${team.color}${dispatched ? ' is-dispatched' : ''}`} key={team.id}>
                <span className="team-check">{dispatched ? '✓' : '·'}</span><span><b>{team.label}</b><small>{dispatched ? 'A CAMINHO' : team.short}</small></span>
              </div>;
            })}
          </div>
          <button className={`tablet-action${resolved ? ' is-complete' : ''}`} disabled={resolved || !selected || (!nextTeam && selectedInGame)} onClick={onAction}>
            <span>{resolved ? '✦' : !selectedInGame ? '◉' : '➜'}</span>{actionLabel}<kbd>{resolved ? 'OK' : 'E'}</kbd>
          </button>
          <small className="tablet-action-hint">{resolved ? 'Ocorrência encerrada.' : !selected ? 'Selecione um alerta para iniciar o atendimento.' : !selectedInGame ? 'Confirme a ocorrência para liberar o atendimento.' : 'Acione a próxima equipe para continuar o plano.'}</small>
        </div>
      </div>
      <footer className="tablet-footer"><span><i /> CONEXÃO ESTÁVEL</span><span>ANALISTA <b>◆</b> DISPOSITIVO SINCRONIZADO</span></footer>
    </div>
  </section>;
}
