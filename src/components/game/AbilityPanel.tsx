'use client';

import { useState } from 'react';
import type { AbilitySnapshot, InfraTool, MapPoint } from '@/game/core/AbilityLab';

type Props = {
  state: AbilitySnapshot;
  onUse: () => void; onTool: (tool: InfraTool) => void;
  onStop: (index: number) => void; onMap: (point: MapPoint, mark: boolean) => void;
  onInspect: (id: number, mark?: boolean) => void; onReset: () => void;
};
const project = (value: number) => (value + 8) / 16 * 200;

export default function AbilityPanel({ state, onUse, onTool, onStop, onMap, onInspect, onReset }: Props) {
  const [markMode, setMarkMode] = useState(false);
  const stops = state.editing ? state.draft : state.stops;
  const selected = state.issues.find(issue => issue.id === state.selectedIssue);
  const mapClick = (event: React.MouseEvent<SVGSVGElement>, mark = markMode) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onMap({ x: (event.clientX - rect.left) / rect.width * 16 - 8, z: (event.clientY - rect.top) / rect.height * 16 - 8 }, mark);
  };
  return <aside className="ability-panel" aria-label="Teste de habilidade">
    <span className="ability-kicker">TESTE LIVRE · {state.role === 1 ? 'EQUIPAMENTOS' : state.role === 2 ? 'TRANSPORTE' : 'DIAGNÓSTICO'}</span>
    <h2>{state.role === 1 ? 'Instalar e iluminar' : state.role === 2 ? 'Desenhar uma rota' : 'Investigar e marcar'}</h2>
    <p className="ability-help">{state.role === 1 ? 'Ande pela plataforma. A ferramenta atua à sua frente.' : state.role === 2 ? 'Enter abre a edição. Escolha um ponto e clique no mapa para movê-lo.' : 'Clique em ? para revelar um problema simulado. Botão direito marca um risco já revelado.'}</p>
    {state.role === 1 && <>
      <div className="ability-options" role="group" aria-label="Ferramenta">
        <button aria-pressed={state.tool === 'sensor'} onClick={event => { onTool('sensor'); event.currentTarget.blur(); }}>Sensor · {state.sensors.length}/5</button>
        <button aria-pressed={state.tool === 'light'} onClick={event => { onTool('light'); event.currentTarget.blur(); }}>Iluminação</button>
      </div>
      <button className="ability-primary" onClick={event => { onUse(); event.currentTarget.blur(); }}>E · {state.tool === 'sensor' ? 'Instalar sensor' : 'Alternar luz'}</button>
      {state.tool === 'light' && <small className="ability-hint">Suave → forte → desligada. A luz permanece no local de instalação.</small>}
    </>}
    {state.role === 2 && <>
      <button className="ability-primary" onClick={event => { onUse(); event.currentTarget.blur(); }}>Enter · {state.editing ? 'Aplicar rota' : 'Editar pontos e rota'}</button>
      {state.editing && <div className="ability-options" role="group" aria-label="Ponto para mover">
        {stops.map((_, index) => <button key={index} aria-pressed={state.selectedStop === index} onClick={event => { onStop(index); event.currentTarget.blur(); }}>Ponto {'ABC'[index]}</button>)}
      </div>}
      <small className="ability-hint">{state.editing ? 'Movimento pausado durante a edição. Trocar de personagem descarta alterações não aplicadas.' : 'WASD para andar. A linha roxa mostra a rota de teste.'}</small>
    </>}
    {state.role === 3 && <div className="ability-options" role="group" aria-label="Modo do mouse">
      <button aria-pressed={!markMode} onClick={() => setMarkMode(false)}>Inspecionar</button>
      <button aria-pressed={markMode} onClick={() => setMarkMode(true)}>Marcar risco</button>
    </div>}
    <div className="ability-map-wrap">
      <svg className="ability-map" viewBox="0 0 200 200" role="img" aria-label="Mapa abstrato de teste. Use os controles abaixo ou clique nos indicadores." onClick={event => mapClick(event)} onContextMenu={event => { event.preventDefault(); mapClick(event, true); }}>
        <defs><pattern id="ability-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#29434b" strokeWidth="1" /></pattern></defs>
        <rect width="200" height="200" fill="#0d2028" /><rect width="200" height="200" fill="url(#ability-grid)" />
        <polyline points={stops.map(stop => `${project(stop.x)},${project(stop.z)}`).join(' ')} fill="none" stroke="#bc97ed" strokeWidth="2" strokeDasharray={state.editing ? '4 3' : undefined} />
        {stops.map((stop, index) => <g key={index} transform={`translate(${project(stop.x)} ${project(stop.z)})`}>
          <circle r="7" fill={state.editing && state.selectedStop === index ? '#e6d6ff' : '#7854a1'} stroke="#d5b9fa" />
          <text textAnchor="middle" dy="3" fontSize="9" fill={state.editing && state.selectedStop === index ? '#18202a' : '#fff'}>{'ABC'[index]}</text>
        </g>)}
        {state.sensors.map((sensor, index) => <g key={index} transform={`translate(${project(sensor.x)} ${project(sensor.z)})`}><circle r="18" fill="#62d7a712" stroke="#62d7a7" strokeWidth="0.7" /><circle r="3" fill="#62d7a7" /></g>)}
        {state.light && <circle cx={project(state.light.x)} cy={project(state.light.z)} r={state.light.level ? state.light.level * 10 + 5 : 4} fill={state.light.level ? '#ffe19a33' : '#77838b'} stroke="#ffe19a" />}
        {state.issues.filter(issue => state.role === 3 || issue.marked).map(issue => <g key={issue.id} transform={`translate(${project(issue.x)} ${project(issue.z)})`}>
          <circle r="9" fill={issue.marked ? '#a83935' : '#18394b'} stroke={issue.marked ? '#ff806d' : '#79b8ff'} strokeWidth="1.5" />
          <text textAnchor="middle" dy="3.5" fontSize="11" fill="#fff">{issue.marked ? '!' : issue.revealed ? issue.id : '?'}</text>
        </g>)}
      </svg>
      <small>MAPA ABSTRATO · DADOS SIMULADOS</small>
    </div>
    {state.role === 3 && <>
      <div className="ability-options" aria-label="Inspecionar pontos de teste">
        {state.issues.map(issue => <button key={issue.id} aria-pressed={state.selectedIssue === issue.id} onClick={() => onInspect(issue.id)}>Ponto {issue.id}{issue.marked ? ' !' : ''}</button>)}
      </div>
      {selected?.revealed && <div className="ability-finding"><b>{selected.title}</b><button onClick={() => onInspect(selected.id, true)}>{selected.marked ? 'Remover marcação' : 'Marcar para a equipe'}</button></div>}
    </>}
    <p className="ability-message" role="status" aria-live="polite">{state.message}</p>
    <button className="ability-reset" onClick={event => { onReset(); event.currentTarget.blur(); }}>Reiniciar teste das três</button>
  </aside>;
}
