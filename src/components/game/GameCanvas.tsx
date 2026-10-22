'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Game, type GameSceneId, type GameStatus } from '@/game/core/Game';
import { PLAYER_APPEARANCES, type PlayerId } from '@/game/entities/Player';
import { AbilityLab } from '@/game/core/AbilityLab';
import AbilityPanel from './AbilityPanel';
import type { RiskSnapshot } from '@/game/risks/RiskWorkflow';
import RepairPuzzle from './RepairPuzzle';
import GameObjectiveHUD from './GameObjectiveHUD';
import OrdersHud from './OrdersHud';
import OrlaTablet from './OrlaTablet';

const playerIds: PlayerId[] = [1, 2, 3];

const directions = [
  { code: 'ArrowUp', label: 'Mover para cima', symbol: '↑' },
  { code: 'ArrowLeft', label: 'Mover para esquerda', symbol: '←' },
  { code: 'ArrowDown', label: 'Mover para baixo', symbol: '↓' },
  { code: 'ArrowRight', label: 'Mover para direita', symbol: '→' },
];

export default function GameCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [sceneId, setSceneId] = useState<GameSceneId>('test');
  const isLaboratory = sceneId === 'test';
  const isOriginalOrla = sceneId === 'fase1-orla';
  const [status, setStatus] = useState<GameStatus>('ready');
  const [initialized, setInitialized] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerId>(1);
  const isAnalystTablet = isOriginalOrla && selectedPlayer === 3;
  const [closeView, setCloseView] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [, setRisks] = useState<RiskSnapshot | null>(null);
  const [interactionPrompt, setInteractionPrompt] = useState<string | null>(null);
  const [repairPuzzleOpen, setRepairPuzzleOpen] = useState(false);
  const [abilities, setAbilities] = useState(() => new AbilityLab().snapshot());
  const [objectiveDistance, setObjectiveDistance] = useState<number | null>(null);

  useEffect(() => {
    if (!host.current) return;
    let instance: Game;
    try {
      instance = new Game(host.current, value => { setStatus(value); if (value === 'playing') setCloseView(game.current?.isCloseView ?? false); }, setAbilities, setSelectedPlayer, setRisks, setInteractionPrompt, setRepairPuzzleOpen, setObjectiveDistance);
      game.current = instance;
      setInitialized(true);
      setError(null);
    } catch (cause) {
      console.error('Falha ao inicializar o jogo:', cause);
      setError('Não foi possível iniciar o 3D. Verifique se a aceleração gráfica está habilitada e recarregue a página.');
      return;
    }
    return () => { instance.dispose(); game.current = null; };
  }, []);

  useEffect(() => {
    if (status === 'playing' || !panel.current) return;
    const context = gsap.context(() => {
      gsap.from(panel.current, {
        opacity: 0, y: 12,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.45,
      });
    }, panel);
    return () => context.revert();
  }, [status, error]);

  const returnToMenu = () => {
    game.current?.returnToMenu();
    setSceneId('test');
    setRisks(null);
    setSelectedPlayer(1);
    setCloseView(false);

    setObjectiveDistance(null);
  };

  return (
    <section className={`game-shell${isLaboratory ? '' : ' is-orla'}`} aria-label="Suburban — jogo de mobilidade urbana">
      <div ref={host} className="viewport" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>SUBURBAN<small>{isLaboratory ? 'LABORATÓRIO DE HABILIDADES' : 'FASE 1 · ORLA'}</small></span></div>
        <span className="build-label">{isLaboratory ? 'TESTE LIVRE' : 'ORLA ORIGINAL'}</span>
      </header>
      {((status !== 'playing' && status !== 'finished') || error) && (
        <div className="overlay">
          <div ref={panel} className="panel">
            <span className="eyebrow">{error ? 'INICIALIZAÇÃO' : status === 'paused' ? 'UM RESPIRO' : 'O COMEÇO DE UM MUNDO'}</span>
            <h1>{error ? 'Ops, algo falhou.' : status === 'paused' ? 'Jogo pausado.' : <>Tudo começa<br />por aqui<span>.</span></>}</h1>
            <p>{error ?? (status === 'paused' ? 'Sua cena está esperando. Continue quando quiser.' : 'A avenida da praia ganhou mais espaço nas laterais e novos veículos. Acione as equipes, proteja o trecho e recupere a iluminação da Orla.')}</p>
            {error ? <button onClick={() => window.location.reload()}>Tentar novamente ↗</button> :
              <button disabled={!initialized} onClick={event => { if (status === 'ready') { game.current?.start('fase1-orla'); setSceneId('fase1-orla'); setCloseView(false); } else game.current?.togglePause(); event.currentTarget.blur(); }}>
                {!initialized ? 'Preparando…' : status === 'paused' ? 'Continuar →' : 'Jogar na Orla →'}
              </button>}
            {!error && status === 'ready' && <button className="secondary" disabled={!initialized}
              onClick={event => { game.current?.start(); setSceneId('test'); event.currentTarget.blur(); }}>
              Laboratório de habilidades →
            </button>}
            {!error && status === 'paused' && <button className="secondary" onClick={returnToMenu}>Voltar ao menu</button>}
            <div className="stack">ANALISAR <i /> ORGANIZAR <i /> REPARAR</div>
          </div>
        </div>
      )}
      {isOriginalOrla && !error && <OrdersHud paused={status !== 'playing'} onMenu={returnToMenu} />}
      {isOriginalOrla && repairPuzzleOpen && <RepairPuzzle paused={status !== 'playing'} onComplete={() => game.current?.completeRepairPuzzle()} />}
      {status === 'playing' && !error && <>
        {isAnalystTablet && <OrlaTablet onAction={() => game.current?.interact()} />}
        <div className="hud"><span><b>[ {PLAYER_APPEARANCES[selectedPlayer].name.toLocaleUpperCase('pt-BR')} ]</b><small>{!isLaboratory ? 'WASD · mover / Shift · correr / E · ação / T · trocar' : selectedPlayer === 3 ? 'Mouse · investigar e marcar / T · trocar' : 'WASD · mover / Shift · correr / T · trocar'}</small></span><button className="secondary" onClick={() => game.current?.togglePause()}>Pausar · Esc</button></div>
        {isOriginalOrla && <GameObjectiveHUD player={selectedPlayer} distance={objectiveDistance} />}
        {!isLaboratory && interactionPrompt && <div className="interaction-prompt" role="status"><kbd>E</kbd> {interactionPrompt}</div>}

        {isLaboratory && <AbilityPanel state={abilities} onUse={() => game.current?.useAbility()} onTool={tool => game.current?.setAbilityTool(tool)} onStop={index => game.current?.selectStop(index)} onMap={(point, mark) => game.current?.clickAbilityMap(point, mark)} onInspect={(id, mark) => game.current?.inspectIssue(id, mark)} onReset={() => game.current?.resetAbilities()} />}
        <div className="character-selector" role="group" aria-label="Escolher personagem">
          {playerIds.map(id => <button key={id} aria-pressed={selectedPlayer === id}
            onClick={event => { game.current?.selectPlayer(id); event.currentTarget.blur(); }}>
            <span className="character-color" style={{ backgroundColor: PLAYER_APPEARANCES[id].shirt }} aria-hidden="true" />
            {PLAYER_APPEARANCES[id].name}
          </button>)}
          <button aria-pressed={closeView} onClick={() => { game.current?.setCloseView(!closeView); setCloseView(!closeView); }}>
            {closeView ? 'Visão ampla' : 'Ver de perto'}
          </button>

        </div>
        {isOriginalOrla && !repairPuzzleOpen && <div className="orla-actions" role="group" aria-label="Ações da equipe">
          <button onClick={event => { game.current?.interact(); event.currentTarget.blur(); }}><kbd>E</kbd> {selectedPlayer === 3 ? 'Acionar equipe' : selectedPlayer === 2 ? 'Cone' : 'Interagir'}</button>
          {selectedPlayer === 2 && ['Liberar', 'Bloquear', 'Inverter', 'Escape', 'Desviar'].map((label, index) =>
            <button key={label} onClick={event => { game.current?.useMobilityHotkey(`Digit${index + 1}`); event.currentTarget.blur(); }}><kbd>{index + 1}</kbd> {label}</button>)}
        </div>}
        {(isOriginalOrla && selectedPlayer !== 3 || (isLaboratory && selectedPlayer !== 3 && !abilities.editing)) && <div className={`touch-controls${isLaboratory ? '' : ' orla-touch-controls'}`} aria-label="Controles de movimento">
          {directions.map(({ code, label, symbol }) => <button key={code} aria-label={label}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); game.current?.input.setTouch(event.pointerId, code); }}
            onPointerUp={event => game.current?.input.setTouch(event.pointerId)}
            onPointerCancel={event => game.current?.input.setTouch(event.pointerId)}
            onLostPointerCapture={event => game.current?.input.setTouch(event.pointerId)}
          >{symbol}</button>)}
          {!isLaboratory && <button className="touch-action" aria-label="Segurar para correr"
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); game.current?.input.setTouch(event.pointerId, 'ShiftLeft'); }}
            onPointerUp={event => game.current?.input.setTouch(event.pointerId)}
            onPointerCancel={event => game.current?.input.setTouch(event.pointerId)}
            onLostPointerCapture={event => game.current?.input.setTouch(event.pointerId)}>Correr</button>}
        </div>}
      </>}
      <footer className="bottom-bar"><span>{isLaboratory && selectedPlayer === 3 ? 'MOUSE' : 'WASD / SETAS'} <small>{isLaboratory && selectedPlayer === 3 ? 'ANALISAR' : 'MOVER · SHIFT CORRER'}</small></span><span>ESC <small>PAUSAR</small></span><span className="prototype-label">{isLaboratory ? 'HABILIDADES · SEM MISSÃO' : 'FASE 1 · ORLA'}</span></footer>
    </section>
  );
}


