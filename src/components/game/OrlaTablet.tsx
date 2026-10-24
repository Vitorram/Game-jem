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
          <div className="tablet-map-callout"><span className="callout-dot" /> {String(activeCount).padStart(2, '0')} {activeCount === 1 ? 'OCORRÊNCIA ATIVA' : 'OCORRÊNCIAS ATIVAS'}</div>
          </div>
          <div className="tablet-section-title tablet-list-title"><span>OCORRÊNCIAS</span><b className="active-tag"><i /> {activeCount} ATIVA{activeCount === 1 ? '' : 'S'}</b></div>
          <div className="tablet-incident-list" role="list" aria-label="Lista de ocorrências">
            {problems.map(problem => {
              const tutorialTarget = tutorialOnList && problem.status !== 'RESOLVED';
              return <button key={problem.id} role="listitem" data-tutorial-target={tutorialTarget ? 'true' : undefined} className={`tablet-incident-card${selectedId === problem.id ? ' is-selected' : ''}${problem.status === 'RESOLVED' ? ' is-resolved' : ''}${tutorialTarget ? ' tutorial-focus' : ''}`} onClick={event => { analyze(problem.id); event.currentTarget.blur(); }}>
                <span className="incident-icon">{problem.type === 'broken-light-pole' || problem.type === 'ev-charger-repair' ? 'ϟ' : '!'}</span>
                <span className="incident-card-copy"><small>{problemCategory(problem)} · {problem.towStatus && problem.towStatus !== 'not-called' ? problem.towStatus === 'done' ? 'VIA LIBERADA' : problem.towStatus === 'loading' ? 'GUINCHO NO LOCAL' : 'GUINCHO A CAMINHO' : problemStatus(problem)}</small><b>{problemTitle(problem)}</b><em>{problemLocation(problem)}{problem.id === 'roadside-breakdown' ? ' · faixa bloqueada' : ` · ${problem.dispatchedTeams.length}/${problem.requiredTeams?.length ?? 2} equipes`}</em></span>
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
              <span data-state={!issue ? 'waiting' : issue.analyzed ? 'done' : 'current'}><i>1</i><b>Analisar chamado</b></span>
              <em aria-hidden="true">›</em>
              <span data-state={!issue ? 'waiting' : allDispatched ? 'done' : issue.analyzed ? 'current' : 'waiting'}><i>2</i><b>Solicitar reforço</b></span>
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
              <div><dt>EQUIPES</dt><dd>{isTowIssue ? 'ATENDIMENTO DA ANALISTA' : `${issue.dispatchedTeams.length}/${requiredTeams.length} ACIONADAS`}</dd></div>
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
          </div>
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
