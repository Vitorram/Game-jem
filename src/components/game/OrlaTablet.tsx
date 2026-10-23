'use client';

import { useEffect, useMemo, useState } from 'react';
import { ORLA_MAP } from '@/game/map/orlaMap';
import { GRID_CONFIG } from '@/game/config';
import { suburbanGameState, type ResponseTeam, type UrbanProblem } from '@/game/core/GameState';

const tiles: Record<string, string> = { '~': 'sea', '.': 'sand', '=': 'prom', '-': 'cycle', R: 'road', '#': 'wall', B: 'counter', E: 'station', C: 'box' };
type ZoneLevel = 'green' | 'yellow' | 'red';
const zoneLabel: Record<ZoneLevel, string> = { green: 'LIVRE', yellow: 'CHEIO', red: 'CRÍTICO' };
const teams: { id: ResponseTeam; label: string; short: string; color: string }[] = [
  { id: 'infraestrutura', label: 'Infraestrutura', short: 'REPARO ELÉTRICO', color: 'mint' },
  { id: 'mobilidade', label: 'Mobilidade', short: 'ISOLAR O TRECHO', color: 'gold' },
];

function problemTitle(problem: UrbanProblem): string {
  return problem.type === 'broken-light-pole' ? 'Poste danificado' : `${problem.label} · ocorrência`;
}

function problemCategory(problem: UrbanProblem): string {
  return problem.type === 'broken-light-pole' ? 'ILUMINAÇÃO'
    : problem.type === 'ev-charger-repair' ? 'MOBILIDADE ELÉTRICA' : 'SERVIÇO URBANO';
}

export type AnalystTutorialStep = 0 | 1 | 2 | 3 | 4 | 5;

export default function OrlaTablet({ onAction, onAnalyze, tutorialStep, onTutorialProgress }: {
  onAction: (problemId?: string) => void;
  onAnalyze?: (problemId: string) => void;
  tutorialStep?: AnalystTutorialStep | null;
  onTutorialProgress?: (milestone: 'selected' | 'confirmed' | 'infrastructure' | 'mobility') => void;
}) {
  const [, refresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => refresh(value => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  const state = suburbanGameState.snapshot();
  const problems = state.problems;
  const issue = problems.find(problem => problem.id === selectedId)
    ?? problems.find(problem => problem.id === state.selectedProblemId)
    ?? problems.find(problem => problem.status !== 'RESOLVED')
    ?? problems[0];
  const selectedInGame = issue?.id === state.selectedProblemId;
  const selected = !!issue && (selectedId === issue.id || selectedInGame);
  const requiredTeams = issue ? teams.filter(team => !issue.requiredTeams || issue.requiredTeams.includes(team.id)) : [];
  const nextTeam = requiredTeams.find(team => !issue?.dispatchedTeams.includes(team.id));
  const resolved = !!issue && issue.status === 'RESOLVED';
  const activeCount = problems.filter(problem => problem.status !== 'RESOLVED').length;
  const queuedVehicles = state.phase?.queuedVehicles ?? 0;
  const waitingPedestrians = state.phase?.waitingPedestrians ?? 0;
  const peakCongestion = Math.max(0, ...state.roads.filter(road => road.type === 'PRINCIPAL').map(road => road.congestion));
  const trafficZone: ZoneLevel = queuedVehicles >= 12 || peakCongestion >= .68 ? 'red'
    : queuedVehicles >= 5 || peakCongestion >= .32 ? 'yellow' : 'green';
  const pedestrianZone: ZoneLevel = waitingPedestrians >= 5 ? 'red' : waitingPedestrians >= 3 ? 'yellow' : 'green';
  const allDispatched = requiredTeams.length > 0 && requiredTeams.every(team => issue?.dispatchedTeams.includes(team.id));
  const actionLabel = tutorialStep !== undefined && tutorialStep !== null ? (!selectedInGame ? 'CONFIRMAR CHAMADO' : nextTeam ? 'SOLICITAR EQUIPE' : 'EQUIPES ACIONADAS') : resolved ? 'ARQUIVAR CHAMADO - RECEBER XP' : !selected ? 'ANALISAR CHAMADO' : !allDispatched ? 'SOLICITAR REFOR\u00C7O' : 'EQUIPES EM CAMPO';
  const infrastructureDispatched = issue?.dispatchedTeams.includes('infraestrutura') ?? false;
  const mobilityDispatched = issue?.dispatchedTeams.includes('mobilidade') ?? false;

  useEffect(() => {
    if (selectedId && !problems.some(problem => problem.id === selectedId)) setSelectedId(null);
  }, [selectedId, problems]);

  const analyze = (problemId: string) => {
    setSelectedId(problemId);
    onTutorialProgress?.('selected');
    if (tutorialStep === undefined || tutorialStep === null) onAnalyze?.(problemId);
  };

  useEffect(() => {
    if (tutorialStep === 2 && selectedInGame) onTutorialProgress?.('confirmed');
    if (tutorialStep === 3 && infrastructureDispatched) onTutorialProgress?.('infrastructure');
    if (tutorialStep === 4 && mobilityDispatched) onTutorialProgress?.('mobility');
  }, [tutorialStep, selectedInGame, infrastructureDispatched, mobilityDispatched, onTutorialProgress]);

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
                const tileClass = kind === '-' && rowIndex === 8 ? 'sidewalk' : tiles[kind] ?? 'sand';
                const trafficZoneTile = kind === 'R' ? ' traffic-zone zone-' + trafficZone : '';
                const electricLaneTile = kind === 'R' && rowIndex === 9 ? ' electric-lane-map' : '';
                const pedestrianZoneTile = rowIndex === 8 && column >= 10 && column <= 12 ? ' pedestrian-zone zone-' + pedestrianZone : '';
                return <div key={rowIndex + '-' + column} role="gridcell" className={'map-tile map-row-' + rowIndex + ' map-col-' + column + ' ' + tileClass + trafficZoneTile + pedestrianZoneTile + electricLaneTile + (issues.length ? ' has-incident' : '')}>
                  {issues.length > 0 && <button aria-label={`Ver ${issues.length > 1 ? `${issues.length} ocorrências` : problemTitle(issues[0])}`} onClick={event => { analyze(issues[0].id); event.currentTarget.blur(); }}>
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
          <div className="tablet-flow-zones" aria-label="Condições de circulação">
            <span className={'flow-zone ' + trafficZone} aria-label={'Veículos: ' + queuedVehicles + ' na fila, condição ' + zoneLabel[trafficZone].toLocaleLowerCase('pt-BR')}>
              <i aria-hidden="true">🚗</i><b>{queuedVehicles}</b><small>CARROS · {zoneLabel[trafficZone]}</small>
            </span>
            <span className={'flow-zone ' + pedestrianZone} aria-label={'Pedestres: ' + waitingPedestrians + ' esperando, condição ' + zoneLabel[pedestrianZone].toLocaleLowerCase('pt-BR')}>
              <i aria-hidden="true">🚶</i><b>{waitingPedestrians}</b><small>PEDESTRES · {zoneLabel[pedestrianZone]}</small>
            </span>
          </div>
          <div className="tablet-map-legend"><span><i className="legend-sea" /> MAR</span><span><i className="legend-green" /> CALÇADÃO</span><span><i className="legend-cycle" /> CICLOVIA</span><span><i className="legend-road" /> AVENIDA</span><span><i className="legend-electric" /> AVENIDA VERDE</span><span><i className="legend-alert">!</i> ALERTA</span></div>
          <div className="tablet-map-callout"><span className="callout-dot" /> {String(activeCount).padStart(2, '0')} {activeCount === 1 ? 'OCORRÊNCIA ATIVA' : 'OCORRÊNCIAS ATIVAS'}</div>
        </div>

        <div className="tablet-incident-column">
          <div className="tablet-section-title"><span>02 / CENTRAL DE OCORRÊNCIAS</span><b className="active-tag"><i /> {activeCount} ATIVA{activeCount === 1 ? '' : 'S'}</b></div>
          <div className="tablet-workflow" aria-label="Fluxo de atendimento">
            <span data-state={!issue ? 'waiting' : issue.analyzed ? 'done' : 'current'}><i>1</i><b>Analisar chamado</b></span>
            <em aria-hidden="true">›</em>
            <span data-state={!issue ? 'waiting' : allDispatched ? 'done' : issue.analyzed ? 'current' : 'waiting'}><i>2</i><b>Solicitar reforço</b></span>
          </div>
          <div className="tablet-incident-list" role="list" aria-label="Lista de ocorrências">
            {problems.map(problem => <button key={problem.id} role="listitem" data-tutorial-target={tutorialStep === 1 && problem.status !== 'RESOLVED' ? 'true' : undefined} className={`tablet-incident-card${selectedId === problem.id ? ' is-selected' : ''}${problem.status === 'RESOLVED' ? ' is-resolved' : ''}${tutorialStep === 1 && problem.status !== 'RESOLVED' ? ' tutorial-focus' : ''}`} onClick={event => { analyze(problem.id); event.currentTarget.blur(); }}>
              <span className="incident-icon">{problem.type === 'broken-light-pole' || problem.type === 'ev-charger-repair' ? 'ϟ' : '!'}</span>
              <span className="incident-card-copy"><small>{problemCategory(problem)} · {problem.status === 'RESOLVED' ? 'RESOLVIDA' : problem.status === 'MAINTENANCE' ? 'EM ATENDIMENTO' : 'ATENÇÃO'}</small><b>{problemTitle(problem)}</b><em>{problem.type === 'broken-light-pole' ? 'Av. da Orla' : problem.type === 'ev-charger-repair' ? 'Avenida Verde' : 'Setor Orla'} · {problem.dispatchedTeams.length}/{problem.requiredTeams?.length ?? 2} equipes</em></span>
              <span className="incident-chevron">›</span>
            </button>)}
            {!problems.length && <div className="tablet-empty-list">A central está monitorando. O próximo chamado chega no horário previsto.</div>}
          </div>
          <div className={`tablet-detail-card${!selected || !issue ? ' is-unselected' : ''}`}>
            <div className="tablet-detail-heading"><span className="detail-alert">!</span><div><small>RELATÓRIO DE CAMPO</small><b>{selected && issue ? problemTitle(issue) : 'Selecione uma ocorrência'}</b></div></div>
            <p>{selected && issue ? resolved && issue.type === 'broken-light-pole'
              ? 'Reparo concluído. Troque para Mobilidade e use 1 para reabrir a via principal.'
              : issue.instruction ?? (issue.type === 'broken-light-pole'
                ? 'A luminária está apagada e a estrutura do poste foi comprometida. Proteja o trecho antes do reparo elétrico.'
                : 'Ocorrência registrada no mapa. Analise o local e escolha as equipes adequadas para o atendimento.')
              : 'Escolha um alerta na lista ou no mapa para abrir os detalhes e preparar o atendimento.'}</p>
            {selected && issue && <div className="detail-tags"><span>{issue.status === 'RESOLVED' ? 'RESOLVIDA' : 'RISCO EM ANÁLISE'}</span><span>{issue.dispatchedTeams.length}/{requiredTeams.length} EQUIPES ACIONADAS</span></div>}
          </div>
          <div className="tablet-team-title"><span>PLANO DE RESPOSTA</span><small>{issue?.dispatchedTeams.length ?? 0}/{requiredTeams.length} EQUIPES</small></div>
          <div className="tablet-teams">
            {requiredTeams.map(team => {
              const dispatched = issue?.dispatchedTeams.includes(team.id) ?? false;
              const taskLabel = issue?.id === 'ev-charger-repair'
                ? team.id === 'mobilidade' ? 'HABILIDADE 4 · DESVIAR ELÉTRICOS' : 'REPARAR CARREGADOR'
                : team.short;
              return <div className={`tablet-team ${team.color}${dispatched ? ' is-dispatched' : ''}`} key={team.id}>
                <span className="team-check">{dispatched ? '✓' : '·'}</span><span><b>{team.label}</b><small>{dispatched ? 'A CAMINHO' : taskLabel}</small></span>
              </div>;
            })}
          </div>
          <button data-tutorial-target={tutorialStep !== undefined && tutorialStep !== null && tutorialStep >= 2 && tutorialStep <= 4 ? 'true' : undefined} className={`tablet-action${resolved ? ' is-complete' : ''}${tutorialStep !== undefined && tutorialStep !== null && tutorialStep >= 2 && tutorialStep <= 4 ? ' tutorial-focus' : ''}`} disabled={!selected || (!resolved && allDispatched && tutorialStep == null)} onClick={event => { onAction(issue?.id); event.currentTarget.blur(); }}><span>{resolved ? '✦' : allDispatched ? '✓' : !selected ? '!' : '➜'}</span>{actionLabel}<kbd>{resolved ? 'XP' : 'E'}</kbd></button>
          <small className="tablet-action-hint">{!issue ? 'Aguarde o pr\u00F3ximo chamado da central.' : resolved ? 'Relat\u00F3rio conclu\u00EDdo. Arquive para registrar XP e liberar o pr\u00F3ximo chamado.' : !selected ? 'Clique no chamado da lista ou no alerta do mapa para analisar.' : !issue.analyzed ? 'Leia o relat\u00F3rio e confirme a an\u00E1lise para continuar.' : allDispatched ? 'Refor\u00E7o solicitado. Escolha uma equipe liberada para agir.' : 'An\u00E1lise conclu\u00EDda. Solicite refor\u00E7o para liberar a equipe.'}</small>
        </div>
      </div>
      <footer className="tablet-footer"><span><i /> CONEXÃO ESTÁVEL</span><span>ANALISTA <b>◆</b> DISPOSITIVO SINCRONIZADO</span></footer>
    </div>
  </section>;
}
