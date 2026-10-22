'use client';

import { useEffect, useState } from 'react';
import { ORLA_MAP } from '@/game/map/orlaMap';
import { suburbanGameState, type ResponseTeam } from '@/game/core/GameState';

const INCIDENT = { column: 5, row: 7 };
const tiles: Record<string, string> = { '~': 'sea', '.': 'sand', '=': 'prom', '-': 'cycle', R: 'road', '#': 'wall', B: 'counter', E: 'station', C: 'box' };
const teams: { id: ResponseTeam; label: string; short: string; color: string }[] = [
  { id: 'infraestrutura', label: 'Infraestrutura', short: 'REPARO ELÉTRICO', color: 'mint' },
  { id: 'mobilidade', label: 'Mobilidade', short: 'ISOLAR O TRECHO', color: 'gold' },
];

export default function OrlaTablet({ onAction }: { onAction: () => void }) {
  const [, refresh] = useState(0);
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => refresh(value => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  const state = suburbanGameState.snapshot();
  const pole = state.problems[0];
  const selectedInGame = state.selectedProblemId === pole?.id;
  const nextTeam = teams.find(team => !pole?.dispatchedTeams.includes(team.id));
  const resolved = !pole || pole.status === 'RESOLVED';
  const actionLabel = resolved ? 'OCORRÊNCIA RESOLVIDA' : !selected ? 'SELECIONE NO MAPA' : !selectedInGame ? 'CONFIRMAR OCORRÊNCIA' : nextTeam ? `ACIONAR ${nextTeam.label.toLocaleUpperCase('pt-BR')}` : 'EQUIPES ACIONADAS';

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
                const isIncident = rowIndex === INCIDENT.row && column === INCIDENT.column;
                const content = isIncident
                  ? <span className={`tablet-map-pin${selected ? ' is-selected' : ''}`}><i>!</i></span>
                  : ['B', 'C', 'E'].includes(kind) ? <span className={`map-object object-${kind.toLowerCase()}`}>{kind === 'B' ? '▰' : kind === 'C' ? '□' : '⌂'}</span> : '';
                const tileClass = kind === '-' && rowIndex === 7 ? 'sidewalk' : tiles[kind] ?? 'sand';
                return <div key={`${rowIndex}-${column}`} role="gridcell" className={`map-tile map-row-${rowIndex} map-col-${column} ${tileClass}${isIncident ? ' has-incident' : ''}`}>
                  {isIncident ? <button aria-label="Ver ocorrência: poste danificado" onClick={() => setSelected(true)}>{content}</button> : content}
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
          <div className="tablet-map-callout"><span className="callout-dot" /> 01 OCORRÊNCIA ATIVA</div>
        </div>

        <div className="tablet-incident-column">
          <div className="tablet-section-title"><span>02 / CENTRAL DE OCORRÊNCIAS</span><b className="active-tag"><i /> ATIVO</b></div>
          <button className={`tablet-incident-card${selected ? ' is-selected' : ''}`} onClick={() => setSelected(true)}>
            <span className="incident-icon">⚡</span><span className="incident-card-copy"><small>INCIDENTE · ILUMINAÇÃO</small><b>Poste danificado</b><em>Av. da Orla · Ponto 01</em></span><span className="incident-chevron">›</span>
          </button>
          <div className={`tablet-detail-card${selected ? '' : ' is-unselected'}`}>
            <div className="tablet-detail-heading"><span className="detail-alert">!</span><div><small>RELATÓRIO DE CAMPO</small><b>Situação identificada</b></div></div>
            <p>{selected ? 'A luminária está apagada e a estrutura do poste foi comprometida. O trecho precisa ser protegido antes do reparo elétrico.' : 'Toque no alerta do mapa para abrir os detalhes da ocorrência e preparar o atendimento.'}</p>
            {selected && <div className="detail-tags"><span>RISCO À VISIBILIDADE</span><span>VIA EM OPERAÇÃO</span></div>}
          </div>
          <div className="tablet-team-title"><span>PLANO DE RESPOSTA</span><small>{pole?.dispatchedTeams.length ?? 0}/2 EQUIPES</small></div>
          <div className="tablet-teams">
            {teams.map(team => {
              const dispatched = pole?.dispatchedTeams.includes(team.id) ?? false;
              return <div className={`tablet-team ${team.color}${dispatched ? ' is-dispatched' : ''}`} key={team.id}>
                <span className="team-check">{dispatched ? '✓' : '·'}</span><span><b>{team.label}</b><small>{dispatched ? 'A CAMINHO' : team.short}</small></span>
              </div>;
            })}
          </div>
          <button className={`tablet-action${resolved ? ' is-complete' : ''}`} disabled={resolved || !selected || (!nextTeam && selectedInGame)} onClick={onAction}>
            <span>{resolved ? '✦' : !selectedInGame ? '◎' : '➜'}</span>{actionLabel}<kbd>{resolved ? 'OK' : 'E'}</kbd>
          </button>
          <small className="tablet-action-hint">{resolved ? 'Luz restabelecida na Orla.' : !selected ? 'Escolha o ponto marcado no mini mapa.' : !selectedInGame ? 'Confirme a ocorrência para liberar o atendimento.' : 'Selecione a equipe seguinte para continuar o plano.'}</small>
        </div>
      </div>
      <footer className="tablet-footer"><span><i /> CONEXÃO ESTÁVEL</span><span>ANALISTA <b>◆</b> DISPOSITIVO SINCRONIZADO</span></footer>
    </div>
  </section>;
}
