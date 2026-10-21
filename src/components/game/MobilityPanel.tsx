'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { suburbanGameState, type RoadState } from '@/game/core/GameState';
import type { MobilityRoadAction } from '@/game/traffic/TrafficSystem';

const roadNames: Record<string, string> = {
  'orla-eastbound': 'Avenida Principal · Leste',
  'orla-eastbound-2': 'Avenida Principal · Leste 2',
  'orla-westbound': 'Avenida Principal · Oeste',
  'orla-westbound-2': 'Avenida Principal · Oeste 2',
  'orla-escape': 'Via de Escape',
};
const actionList: { action: MobilityRoadAction; label: string; hotkey: string; hint: string }[] = [
  { action: 'release', label: 'LIBERAR VIA', hotkey: '1', hint: 'Reabre a via selecionada' },
  { action: 'block', label: 'BLOQUEAR VIA', hotkey: '2', hint: 'Interrompe o fluxo nesta via' },
  { action: 'reverse', label: 'ALTERAR SENTIDO', hotkey: '3', hint: 'Inverte o fluxo dos veículos' },
  { action: 'escape', label: 'ABRIR ROTA', hotkey: '4', hint: 'Abre a conexão e desvia parte do fluxo' },
  { action: 'redirect', label: 'REDIRECIONAR FLUXO', hotkey: '5', hint: 'Desvia até 2 veículos pela rota de escape' },
  { action: 'placeCones', label: 'COLOCAR CONES', hotkey: '6', hint: 'Bloqueia um trecho desta faixa' },
  { action: 'removeCones', label: 'REMOVER CONES', hotkey: '7', hint: 'Libera o trecho sinalizado' },
];

export default function MobilityPanel({ initialRoadId, onAction, onClose }: {
  initialRoadId: string;
  onAction: (roadId: string, action: MobilityRoadAction, coneZoneId?: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const runActionRef = useRef<(action: MobilityRoadAction) => void>(() => undefined);
  const [roads, setRoads] = useState(() => suburbanGameState.snapshot().roads);
  const [selectedId, setSelectedId] = useState(initialRoadId);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [coneZone, setConeZone] = useState('A');
  const selected = roads.find(road => road.id === selectedId) ?? roads[0];
  const escape = roads.find(road => road.type === 'ESCAPE');

  useEffect(() => {
    const context = gsap.context(() => {
      gsap.fromTo(panelRef.current, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.28, ease: 'power2.out' });
    }, panelRef);
    return () => context.revert();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setRoads(suburbanGameState.snapshot().roads), 250);
    return () => window.clearInterval(timer);
  }, []);

  const runAction = (action: MobilityRoadAction) => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    setMessage('');
    const tween = { value: 0 };
    gsap.to(tween, {
      value: 100,
      duration: 1.25,
      ease: 'none',
      onUpdate: () => setProgress(Math.round(tween.value)),
      onComplete: () => {
        onAction(selectedId, action, action === 'placeCones' ? coneZone : undefined);
        setMessage(action === 'placeCones' ? `🚧 CONES COLOCADOS · ZONA ${coneZone}`
          : action === 'removeCones' ? '✓ CONES REMOVIDOS'
          : action === 'reverse' ? '↔ SENTIDO ALTERADO'
          : action === 'block' ? '⚠ VIA BLOQUEADA'
          : action === 'escape' ? '↗ ROTA DE ESCAPE ATUALIZADA'
          : action === 'redirect' ? '↘ FLUXO REDIRECIONADO'
          : '✓ VIA LIBERADA');
        setBusy(false);
        window.setTimeout(() => setMessage(''), 1800);
      },
    });
  };

  useEffect(() => { runActionRef.current = runAction; });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || busy) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < actionList.length) {
        event.preventDefault();
        runActionRef.current(actionList[index].action);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy]);

  const statusLabel = (road: RoadState) => road.status === 'blocked' ? 'BLOQUEADA' : road.status === 'stopped' ? 'TRÂNSITO PAUSADO' : 'LIBERADA';
  const load = selected ? Math.min(100, Math.round(selected.vehicleCount * 12.5 / selected.capacity * 100)) : 0;

  return (
    <div className="mobility-panel-overlay" role="dialog" aria-modal="true" aria-labelledby="mobility-panel-title">
      <div ref={panelRef} className="mobility-panel">
        <header className="mobility-panel-header"><div><span className="mobility-kicker">GESTÃO VIÁRIA</span><h2 id="mobility-panel-title">CONTROLE DE MOBILIDADE</h2></div><button className="mobility-close" onClick={onClose} disabled={busy} aria-label="Fechar painel">×</button></header>
        <div className="mobility-road-tabs" role="tablist" aria-label="Selecionar via">
          {roads.map(road => <button key={road.id} role="tab" aria-selected={selectedId === road.id} onClick={() => !busy && setSelectedId(road.id)} disabled={busy}>
            <span>{roadNames[road.id] ?? road.id}</span><b className={road.status === 'blocked' ? 'is-blocked' : road.status === 'stopped' ? 'is-stopped' : ''}>{statusLabel(road)}</b>
          </button>)}
        </div>
        {selected && <>
          <div className="mobility-selected-road">
            <div className="mobility-road-title"><h3>{roadNames[selected.id] ?? selected.id}</h3><span className={`mobility-state-pill${selected.status === 'blocked' ? ' is-blocked' : ''}`}>{statusLabel(selected)}</span></div>
            <div className="mobility-stats"><span>SENTIDO <b>{selected.direction}</b></span><span>FLUXO <b>{Math.round(selected.congestion * 100)}%</b></span><span>CARGA <b>{load}%</b></span><span>CAPACIDADE <b>{selected.capacity}</b></span></div>
            <div className="mobility-load-track"><span style={{ width: `${Math.max(load, Math.round(selected.congestion * 100))}%` }} /></div>
            <div className="mobility-traffic-visual" aria-label={`Setas indicam o sentido ${selected.direction}`}>
              {selected.status === 'blocked' ? '■ ■ ■ ■ ■' : selected.direction === 'NORMAL' ? '→ → → → →' : '← ← ← ← ←'}
              <small>{selected.type}{selected.redirected ? ' · FLUXO REDIRECIONADO' : ''}</small>
            </div>
          </div>
          {selected.type === 'PRINCIPAL' && <div className="mobility-cone-zones" aria-label="Escolher ponto para os cones">
            <span>{selected.conesActive ? `CONES NA ZONA ${selected.coneZoneId}` : 'PONTO DA INTERVENÇÃO'}</span>
            {!selected.conesActive && <div>{['A', 'B', 'C'].map(zone => <button key={zone} type="button" aria-pressed={coneZone === zone} disabled={busy} onClick={() => setConeZone(zone)}>ZONA {zone}</button>)}</div>}
          </div>}
          {escape && <div className={`mobility-escape-summary${escape.status === 'blocked' ? ' is-blocked' : ''}`}><span>VIA DE ESCAPE · {escape.status === 'open' ? 'LIBERADA' : 'FECHADA'}</span><b>{escape.vehicleCount}/{Math.max(1, Math.floor(escape.capacity / 15))} vagas · capacidade {escape.capacity}</b></div>}
          {busy && <div className="mobility-action-progress"><div><span>APLICANDO ALTERAÇÃO...</span><b>{progress}%</b></div><i><span style={{ width: `${progress}%` }} /></i></div>}
          {!busy && message && <div className="mobility-action-message" role="status">{message}</div>}
          <div className="mobility-actions">
            {actionList.map(({ action, label, hotkey, hint }) => {
              const disabled = (action === 'release' && selected.status !== 'blocked')
                || (action === 'block' && selected.status === 'blocked')
                || (action === 'redirect' && (escape?.status !== 'open' || (selected.redirected && selected.status === 'blocked')))
                || (action === 'placeCones' && (selected.type !== 'PRINCIPAL' || selected.conesActive))
                || (action === 'removeCones' && !selected.conesActive);
              const text = action === 'escape' && escape?.status === 'open' ? 'FECHAR ROTA'
                : action === 'escape' ? 'ABRIR ROTA'
                : action === 'redirect' && selected.redirected ? selected.status === 'blocked' ? 'FLUXO DESVIADO' : 'RESTAURAR FLUXO' : label;
              const actionHint = action === 'redirect' && selected.redirected && selected.status === 'blocked'
                ? 'Libere a via para restaurar o fluxo' : hint;
              return <button key={action} disabled={busy || disabled} onClick={() => runAction(action)}><kbd>{hotkey}</kbd><span><b>{text}</b><small>{actionHint}</small></span><i>›</i></button>;
            })}
          </div>
        </>}
        <footer className="mobility-panel-footer">WASD BLOQUEADO · 1–7 AÇÕES · E FECHAR</footer>
      </div>
    </div>
  );
}
