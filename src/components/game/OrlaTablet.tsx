'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ORLA_MAP } from '@/game/map/orlaMap';
import { ROAD_LAYOUT } from '@/game/map/roadLayout';
import { GRID_CONFIG, ORLA_CROSSING } from '@/game/config';
import { suburbanGameState, type ResponseTeam, type UrbanProblem } from '@/game/core/GameState';

const tiles: Record<string, string> = { '~': 'sea', '.': 'sand', '=': 'prom', '-': 'cycle', R: 'road', '#': 'wall', B: 'counter', E: 'station', C: 'box' };
type ZoneLevel = 'green' | 'yellow' | 'red';
const zoneLabel: Record<ZoneLevel, string> = { green: 'LIVRE', yellow: 'CHEIO', red: 'CRÍTICO' };
const teams: { id: ResponseTeam; label: string; short: string; color: string }[] = [
  { id: 'infraestrutura', label: 'Infraestrutura', short: 'REPARO ELÉTRICO', color: 'mint' },
  { id: 'mobilidade', label: 'Mobilidade', short: 'ISOLAR O TRECHO', color: 'gold' },
];

const MAP_COLUMNS = ORLA_MAP.rows[0].length;
const MAP_ROWS = ORLA_MAP.rows.length;

const MAP_WIDTH = MAP_COLUMNS * GRID_CONFIG.tileSize;
const MAP_DEPTH = MAP_ROWS * GRID_CONFIG.tileSize;

const SIDEWALK_ROW = ORLA_MAP.rows.findIndex(
  (row, index) => row[0] === '-' && ORLA_MAP.rows[index + 1]?.[0] === 'R'
);

const ROAD_ROW = SIDEWALK_ROW + 1;
const ROAD_DEPTH = (MAP_ROWS - ROAD_ROW) * GRID_CONFIG.tileSize;

const CROSSING_COLUMN = Math.floor(
  (ORLA_CROSSING.centerX + MAP_WIDTH / 2) / GRID_CONFIG.tileSize
);

const SCALE_METERS = 10;

const percent = (value: number, total: number) =>
  `${(value / total) * 100}%`;

const mapStyle = {
  '--map-columns': MAP_COLUMNS,
  '--map-rows': MAP_ROWS,
} as CSSProperties;

const roadMarksStyle = {
  top: percent(ROAD_ROW, MAP_ROWS),
  '--green-end': percent(ROAD_LAYOUT.greenWidth, ROAD_DEPTH),
  '--east-dash': percent(ROAD_LAYOUT.eastDash, ROAD_DEPTH),
  '--median': percent(ROAD_LAYOUT.median, ROAD_DEPTH),
  '--west-dash': percent(ROAD_LAYOUT.westDash, ROAD_DEPTH),
  '--bottom-edge': percent(ROAD_LAYOUT.bottomEdge, ROAD_DEPTH),
} as CSSProperties;

const crossingX = (halfWidth: number) => ({
  left: percent(
    ORLA_CROSSING.centerX - halfWidth + MAP_WIDTH / 2,
    MAP_WIDTH
  ),
  width: percent(halfWidth * 2, MAP_WIDTH),
});

const cycleCrossingStyle = {
  ...crossingX(ORLA_CROSSING.rampHalfWidth),
  top: percent(SIDEWALK_ROW - 1, MAP_ROWS),
  height: percent(1, MAP_ROWS),
};

const tactileEdgeStyle = {
  ...crossingX(ORLA_CROSSING.rampHalfWidth),
  top: percent(SIDEWALK_ROW, MAP_ROWS),
};

const curbRampStyle = {
  ...crossingX(ORLA_CROSSING.rampHalfWidth),
  top: `calc(${percent(ROAD_ROW, MAP_ROWS)} - 1.4%)`,
};

const roadCrossingStyle = {
  ...crossingX(ORLA_CROSSING.roadClearHalfWidth),
  top: percent(ROAD_ROW, MAP_ROWS),
  bottom: 0,
};

function problemTitle(problem: UrbanProblem): string {
  return problem.type === 'broken-light-pole' ? 'Poste danificado'
    : problem.id === 'roadside-breakdown' ? 'Carro enguiçado na avenida' : `${problem.label} · ocorrência`;
}

function problemCategory(problem: UrbanProblem): string {
  return problem.type === 'broken-light-pole' ? 'ILUMINAÇÃO'
    : problem.type === 'ev-charger-repair' ? 'MOBILIDADE ELÉTRICA'
      : problem.id === 'roadside-breakdown' ? 'EMERGÊNCIA VIÁRIA' : 'SERVIÇO URBANO';
}

function problemLocation(problem: UrbanProblem): string {
  return problem.id === 'roadside-breakdown' ? 'Av. da Orla · faixa bloqueada'
    : problem.type === 'broken-light-pole' ? 'Av. da Orla'
      : problem.type === 'ev-charger-repair' ? 'Avenida Verde' : 'Setor Orla';
}

function problemStatus(problem: UrbanProblem): string {
  if (problem.status === 'RESOLVED') return 'RESOLVIDA';
  if (problem.towStatus && problem.towStatus !== 'not-called') {
    return problem.towStatus === 'done' ? 'VIA LIBERADA' : problem.towStatus === 'loading' ? 'GUINCHO NO LOCAL' : 'GUINCHO A CAMINHO';
  }
  return problem.status === 'MAINTENANCE' ? 'EM ATENDIMENTO' : 'ATENÇÃO';
}

const towContacts = [
  { id: 'mechanic', name: 'Oficina Móvel da Orla', service: 'MECÂNICA NO LOCAL', number: '0800 000 0130' },
  { id: 'traffic', name: 'Central de Trânsito', service: 'SINALIZAÇÃO E FLUXO', number: '0800 000 0110' },
  { id: 'tow', name: 'Guincho Rota Verde', service: 'REBOQUE 24 HORAS', number: '0800 000 0240' },
] as const;

export type AnalystTutorialStep = 0 | 1 | 2 | 3 | 4 | 5;

export default function OrlaTablet({ onAction, onAnalyze, onCallTow, tutorialStep, onTutorialProgress, onClose }: {
  onAction: (problemId?: string) => void;
  onAnalyze?: (problemId: string) => void;
  onCallTow?: (problemId: string) => boolean;
  onClose?: () => void;
  tutorialStep?: AnalystTutorialStep | null;
  onTutorialProgress?: (milestone: 'selected' | 'confirmed' | 'infrastructure' | 'mobility') => void;
}) {
  const [, refresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneFeedback, setPhoneFeedback] = useState('');
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
  const isTowIssue = issue?.id === 'roadside-breakdown';
  const canCallTow = issue?.towStatus === 'not-called';
  const towProgressLabel = issue?.towStatus === 'en-route' ? 'GUINCHO A CAMINHO'
    : issue?.towStatus === 'loading' ? 'REMOÇÃO EM ANDAMENTO'
      : issue?.towStatus === 'departing' || issue?.towStatus === 'done' ? 'FAIXA LIBERADA' : 'AGUARDANDO CHAMADA';
  const activeCount = problems.filter(problem => problem.status !== 'RESOLVED').length;
  const queuedVehicles = state.phase?.queuedVehicles ?? 0;
  const waitingPedestrians = state.phase?.waitingPedestrians ?? 0;
  const peakCongestion = Math.max(0, ...state.roads.filter(road => road.type === 'PRINCIPAL').map(road => road.congestion));
  const trafficZone: ZoneLevel = queuedVehicles >= 12 || peakCongestion >= .68 ? 'red'
    : queuedVehicles >= 5 || peakCongestion >= .32 ? 'yellow' : 'green';
  const pedestrianZone: ZoneLevel = waitingPedestrians >= 5 ? 'red' : waitingPedestrians >= 3 ? 'yellow' : 'green';
  const allDispatched = requiredTeams.length > 0 && requiredTeams.every(team => issue?.dispatchedTeams.includes(team.id));
  const inTutorial = tutorialStep !== undefined && tutorialStep !== null;
  const tutorialOnList = tutorialStep === 1;
  const tutorialOnAction = inTutorial && tutorialStep >= 2 && tutorialStep <= 4;
  const actionLabel = inTutorial ? (!selectedInGame ? 'CONFIRMAR CHAMADO' : nextTeam ? 'SOLICITAR EQUIPE' : 'EQUIPES ACIONADAS')
    : resolved ? 'ARQUIVAR CHAMADO - RECEBER XP' : !selected ? 'ANALISAR CHAMADO'
      : isTowIssue ? !issue?.analyzed ? 'ANALISAR CHAMADO' : canCallTow ? 'ABRIR LISTA TELEFÔNICA' : towProgressLabel
        : !allDispatched ? 'SOLICITAR REFORÇO' : 'EQUIPES EM CAMPO';
  const infrastructureDispatched = issue?.dispatchedTeams.includes('infraestrutura') ?? false;
  const mobilityDispatched = issue?.dispatchedTeams.includes('mobilidade') ?? false;

  useEffect(() => {
    if (selectedId && !problems.some(problem => problem.id === selectedId)) setSelectedId(null);
  }, [selectedId, problems]);

  useEffect(() => {
    if (!isTowIssue || resolved) setPhoneOpen(false);
  }, [isTowIssue, resolved]);

  const analyze = (problemId: string) => {
    setSelectedId(problemId);
    onTutorialProgress?.('selected');
    if (tutorialStep === undefined || tutorialStep === null) onAnalyze?.(problemId);
  };

  const chooseTowContact = (contactId: string) => {
    if (contactId !== 'tow') {
      setPhoneFeedback(contactId === 'mechanic'
        ? 'A oficina não consegue remover o carro da faixa. Escolha um serviço de reboque.'
        : 'A central orienta o trânsito, mas não reboca veículos. Escolha um serviço de guincho.');
      return;
    }
    if (!issue || !onCallTow?.(issue.id)) {
      setPhoneFeedback('Não foi possível completar a ligação. Tente novamente.');
      return;
    }
    setPhoneFeedback('Guincho acionado. Acompanhe a chegada pela avenida.');
    setPhoneOpen(false);
  };

  useEffect(() => {
    if (tutorialStep === 2 && selectedInGame) onTutorialProgress?.('confirmed');
    if (tutorialStep === 3 && infrastructureDispatched) onTutorialProgress?.('infrastructure');
    if (tutorialStep === 4 && mobilityDispatched) onTutorialProgress?.('mobility');
  }, [tutorialStep, selectedInGame, infrastructureDispatched, mobilityDispatched, onTutorialProgress]);

  const issueByTile = useMemo(() => {
    const result = new Map<string, UrbanProblem[]>();

    for (const problem of problems) {
      const column = Math.floor(
        (problem.position.x + MAP_WIDTH / 2) / GRID_CONFIG.tileSize
      );

      const row = Math.floor(
        (problem.position.z + MAP_DEPTH / 2) / GRID_CONFIG.tileSize
      );

      if (column < 0 || row < 0 || column >= MAP_COLUMNS || row >= MAP_ROWS) continue;

      const key = `${row},${column}`;
      result.set(key, [...(result.get(key) ?? []), problem]);
    }

    return result;
  }, [problems]);

  return <section id="analyst-tablet" className="orla-tablet" aria-label="Tablet de análise da Analista">
    <div className="tablet-shell">
      <header className="tablet-topline">
        <div className="tablet-brand"><span className="tablet-logo">S</span><span>SUBURBAN <small>TERMINAL DE CAMPO</small></span></div>
        <div className="tablet-live"><i /> ORLA · AO VIVO</div>
        {onClose ? <button type="button" className="tablet-close" aria-keyshortcuts="Q" onClick={onClose}><kbd>Q</kbd> Guardar tablet</button>
          : <span className="tablet-battery" aria-label="Bateria cheia"><i /><i /><i /><i /></span>}
      </header>
      <div className="tablet-content">
        <div className="tablet-map-column" data-tutorial-context={tutorialOnList ? 'true' : undefined}>
          <div className="tablet-section-title"><span>01 / MAPA DA ÁREA</span><b>SETOR ORLA</b></div>
          <div className="tablet-map-stage" style={mapStyle}>
            <div className="tablet-map-frame">
              <div className="tablet-map" role="grid" aria-label="Mini mapa da Orla">
                {ORLA_MAP.rows.flatMap((row, rowIndex) => Array.from(row, (kind, column) => {
                  const issues = issueByTile.get(`${rowIndex},${column}`) ?? [];
                  const tileClass = kind === '-' && rowIndex === SIDEWALK_ROW ? 'sidewalk' : tiles[kind] ?? 'sand';
                  const trafficZoneTile = kind === 'R' ? ' traffic-zone zone-' + trafficZone : '';
                  const pedestrianZoneTile = rowIndex === SIDEWALK_ROW && Math.abs(column - CROSSING_COLUMN) <= 1 ? ' pedestrian-zone zone-' + pedestrianZone : '';
                  return <div key={rowIndex + '-' + column} role="gridcell" className={'map-tile ' + tileClass + trafficZoneTile + pedestrianZoneTile + (issues.length ? ' has-incident' : '')}>
                    {issues.length > 0 && <button aria-label={`Ver ${issues.length > 1 ? `${issues.length} ocorrências` : problemTitle(issues[0])}`} onClick={event => { analyze(issues[0].id); event.currentTarget.blur(); }}>
                      <span className={`tablet-map-pin${selectedId === issues[0].id ? ' is-selected' : ''}${issues[0].status === 'RESOLVED' ? ' is-resolved' : ''}`}><i>{issues.length > 1 ? issues.length : '!'}</i></span>
                    </button>}
                    {!issues.length && ['B', 'C', 'E'].includes(kind) && <span className={`map-object object-${kind.toLowerCase()}`}>{kind === 'B' ? '▰' : kind === 'C' ? '□' : '⌂'}</span>}
                  </div>;
                }))}
                <span className="map-road-marks" style={roadMarksStyle} aria-hidden="true" />
                <span className="map-crossing cycle-crossing" style={cycleCrossingStyle} aria-hidden="true" />
                <span className="map-crossing tactile-cycle-edge" style={tactileEdgeStyle} aria-hidden="true" />
                <span className="map-crossing north-curb-ramp" style={curbRampStyle} aria-hidden="true" />
                <span className="map-crossing road-crossing" style={roadCrossingStyle} aria-hidden="true" />
              </div>
              <div className="tablet-map-compass">N <i>▲</i></div>
              <div className="tablet-map-scale"><i style={{ width: `calc(${(SCALE_METERS / MAP_WIDTH) * 100} * var(--map-width) / 100)` }} /> {SCALE_METERS} m</div>
            </div>
          </div>
          <div className="tablet-map-footer">
            <div className="tablet-flow-zones" aria-label="Condições de circulação">
              <span className={'flow-zone ' + trafficZone} aria-label={'Veículos: ' + queuedVehicles + ' na fila, condição ' + zoneLabel[trafficZone].toLocaleLowerCase('pt-BR')}>
                <i aria-hidden="true">🚗</i><b>{queuedVehicles}</b><small>CARROS · {zoneLabel[trafficZone]}</small>
              </span>
              <span className={'flow-zone ' + pedestrianZone} aria-label={'Pedestres: ' + waitingPedestrians + ' esperando, condição ' + zoneLabel[pedestrianZone].toLocaleLowerCase('pt-BR')}>
                <i aria-hidden="true">🚶</i><b>{waitingPedestrians}</b><small>PEDESTRES · {zoneLabel[pedestrianZone]}</small>
              </span>
            </div>
            <div className="tablet-map-legend"><span><i className="legend-sea" /> MAR</span><span><i className="legend-prom" /> CALÇADÃO</span><span><i className="legend-cycle" /> CICLOVIA</span><span><i className="legend-road" /> AVENIDA</span><span><i className="legend-electric" /> AV. VERDE</span><span><i className="legend-alert">!</i> ALERTA</span></div>
          </div>
          <div className="tablet-section-title tablet-list-title"><span>OCORRÊNCIAS</span><b className="active-tag"><i /> {activeCount} ATIVA{activeCount === 1 ? '' : 'S'}</b></div>
          <div className="tablet-incident-list" role="list" aria-label="Lista de ocorrências">
            {problems.map(problem => {
              const tutorialTarget = tutorialOnList && problem.status !== 'RESOLVED';
              return <button key={problem.id} role="listitem" data-tutorial-target={tutorialTarget ? 'true' : undefined} className={`tablet-incident-card${selectedId === problem.id ? ' is-selected' : ''}${problem.status === 'RESOLVED' ? ' is-resolved' : ''}${tutorialTarget ? ' tutorial-focus' : ''}`} onClick={event => { analyze(problem.id); event.currentTarget.blur(); }}>
                <span className="incident-icon">{problem.type === 'broken-light-pole' || problem.type === 'ev-charger-repair' ? 'ϟ' : '!'}</span>
                <span className="incident-card-copy"><small>{problemCategory(problem)} · {problemStatus(problem)}</small><b>{problemTitle(problem)}</b><em>{problemLocation(problem)}{problem.id === 'roadside-breakdown' ? '' : ` · ${problem.dispatchedTeams.length}/${problem.requiredTeams?.length ?? 2} equipes`}</em></span>
                <span className="incident-chevron">›</span>
              </button>;
            })}
            {!problems.length && <div className="tablet-empty-list">A central está monitorando. O próximo chamado chega no horário previsto.</div>}
          </div>
        </div>

        <div className="tablet-incident-column" data-tutorial-context={tutorialOnAction ? 'true' : undefined}>
          <div className="tablet-section-title">
            <span>02 / ATENDIMENTO</span>
            <div className="tablet-workflow" aria-label="Fluxo de atendimento">
              <span data-state={!issue ? 'waiting' : issue.analyzed ? 'done' : 'current'}><i>1</i><b>{isTowIssue ? 'Analisar pane' : 'Analisar chamado'}</b></span>
              <em aria-hidden="true">›</em>
              <span data-state={!issue ? 'waiting' : isTowIssue ? issue.towStatus === 'done' || resolved ? 'done' : issue.towStatus === 'not-called' && issue.analyzed ? 'current' : issue.towStatus === 'not-called' ? 'waiting' : 'current' : allDispatched ? 'done' : issue.analyzed ? 'current' : 'waiting'}><i>2</i><b>{isTowIssue ? 'Chamar guincho' : 'Solicitar reforço'}</b></span>
            </div>
          </div>
          <div className={`tablet-detail-card${!selected || !issue ? ' is-unselected' : ''}`}>
            <div className="tablet-detail-heading"><span className="detail-alert">!</span><div><small>RELATÓRIO DE CAMPO</small><b>{selected && issue ? problemTitle(issue) : 'Selecione uma ocorrência'}</b></div></div>
            <p>{selected && issue ? resolved && issue.type === 'broken-light-pole'
              ? 'Reparo concluído. Troque para Mobilidade e use 1 para reabrir a via principal.'
              : issue.instruction ?? (issue.type === 'broken-light-pole'
                ? 'A luminária está apagada e a estrutura do poste foi comprometida. Proteja o trecho antes do reparo elétrico.'
                : 'Ocorrência registrada no mapa. Analise o local e escolha as equipes adequadas para o atendimento.')
              : 'Escolha um alerta na lista ou no mapa para abrir os detalhes e preparar o atendimento.'}</p>
            {selected && issue && <dl className="tablet-detail-facts">
              <div><dt>LOCAL</dt><dd>{problemLocation(issue)}</dd></div>
              <div><dt>CATEGORIA</dt><dd>{problemCategory(issue)}</dd></div>
              <div><dt>SITUAÇÃO</dt><dd>{issue.status === 'RESOLVED' ? 'RESOLVIDA' : isTowIssue && issue.towStatus !== 'not-called' ? towProgressLabel : 'RISCO EM ANÁLISE'}</dd></div>
              <div>{isTowIssue ? <><dt>ATENDIMENTO</dt><dd>ANALISTA · REBOQUE</dd></> : <><dt>EQUIPES</dt><dd>{issue.dispatchedTeams.length}/{requiredTeams.length} ACIONADAS</dd></>}</div>
            </dl>}
          </div>
          <div className="tablet-team-title"><span>{isTowIssue ? 'CONTATO DE EMERGÊNCIA' : 'PLANO DE RESPOSTA'}</span><small>{isTowIssue ? 'REBOQUE' : `${issue?.dispatchedTeams.length ?? 0}/${requiredTeams.length} EQUIPES`}</small></div>
          {isTowIssue ? <div className="tow-status-card"><span className="tow-status-icon">{issue?.towStatus === 'done' ? '✓' : '↗'}</span><span><b>{towProgressLabel}</b><small>{issue?.towStatus === 'not-called' ? 'Analise o chamado e consulte os contatos disponíveis.' : issue?.towStatus === 'en-route' ? 'O veículo de apoio está se aproximando.' : issue?.towStatus === 'loading' ? 'O carro está sendo preso à plataforma.' : 'O guincho está retirando o carro da avenida.'}</small></span></div> : <div className="tablet-teams">
            {requiredTeams.map(team => {
              const dispatched = issue?.dispatchedTeams.includes(team.id) ?? false;
              const taskLabel = issue?.id === 'ev-charger-repair'
                ? team.id === 'mobilidade' ? 'HABILIDADE 4 · DESVIAR ELÉTRICOS' : 'REPARAR CARREGADOR'
                : team.short;
              return <div className={`tablet-team ${team.color}${dispatched ? ' is-dispatched' : ''}`} key={team.id}>
                <span className="team-check">{dispatched ? '✓' : '·'}</span><span><b>{team.label}</b><small>{dispatched ? 'A CAMINHO' : taskLabel}</small></span>
              </div>;
            })}
            {!requiredTeams.length && <div className="tablet-empty-list">Nenhuma equipe necessária no momento.</div>}
          </div>}
          <div className="tablet-action-dock">
            <button data-tutorial-target={tutorialOnAction ? 'true' : undefined} className={`tablet-action${resolved ? ' is-complete' : ''}${tutorialOnAction ? ' tutorial-focus' : ''}`} disabled={!selected || (!resolved && (isTowIssue ? !!issue?.analyzed && !canCallTow : allDispatched && tutorialStep == null))} onClick={event => { if (isTowIssue && issue?.analyzed && canCallTow) { setPhoneFeedback(''); setPhoneOpen(true); } else onAction(issue?.id); event.currentTarget.blur(); }}><span>{resolved ? '✦' : isTowIssue && canCallTow ? '☎' : allDispatched ? '✓' : !selected ? '!' : '➜'}</span>{actionLabel}<kbd>{resolved ? 'XP' : isTowIssue && canCallTow ? '☎' : 'E'}</kbd></button>
            <small className="tablet-action-hint">{!issue ? 'Aguarde o próximo chamado da central.' : resolved ? 'Relatório concluído. Arquive para registrar XP e liberar o próximo chamado.' : isTowIssue ? !issue.analyzed ? 'Leia o registro da pane para abrir os contatos de emergência.' : canCallTow ? 'Escolha o serviço correto na lista telefônica para enviar o guincho.' : 'Acompanhe a chegada e aguarde o reboque liberar a faixa.' : !selected ? 'Clique no chamado da lista ou no alerta do mapa para analisar.' : !issue.analyzed ? 'Leia o relatório e confirme a análise para continuar.' : allDispatched ? 'Reforço solicitado. Escolha uma equipe liberada para agir.' : 'Análise concluída. Solicite reforço para liberar a equipe.'}</small>
          </div>
        </div>
      </div>
      <footer className="tablet-footer"><span><i /> CONEXÃO ESTÁVEL</span><span>ANALISTA <b>◆</b> DISPOSITIVO SINCRONIZADO</span></footer>
    </div>
    {phoneOpen && isTowIssue && <div className="tow-phone-overlay">
      <div className="tow-phone-dialog" role="dialog" aria-modal="true" aria-labelledby="tow-phone-title" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setPhoneOpen(false); }}>
        <div className="tow-phone-header"><span className="tow-phone-mark">☎</span><div><small>CONTATOS DE EMERGÊNCIA</small><h2 id="tow-phone-title">Lista telefônica</h2></div><button type="button" className="tow-phone-close" aria-label="Fechar lista telefônica" onClick={() => setPhoneOpen(false)}>×</button></div>
        <p className="tow-phone-description">O carro está bloqueando uma faixa. Ligue para o serviço que consegue remover o veículo.</p>
        <div className="tow-contact-list">{towContacts.map(contact => <button type="button" className={`tow-contact-card${contact.id === 'tow' ? ' is-correct' : ''}`} key={contact.id} onClick={() => chooseTowContact(contact.id)}>
          <span className="tow-contact-icon">{contact.id === 'tow' ? '↗' : contact.id === 'mechanic' ? '⚙' : '⇄'}</span><span className="tow-contact-copy"><b>{contact.name}</b><small>{contact.service}</small><em>{contact.number}</em></span><span className="tow-contact-arrow">›</span>
        </button>)}</div>
        {phoneFeedback && <div className="tow-phone-feedback" role="status">{phoneFeedback}</div>}
        <small className="tow-phone-footnote">Números fictícios para esta simulação.</small>
      </div>
    </div>}
  </section>;
}
