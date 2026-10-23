'use client';

import { useEffect, useRef, useState } from 'react';
import StoryIntro from './StoryIntro';
import EntryScreen from './EntryScreen';
import { gsap } from 'gsap';
import { Game, type GameSceneId, type GameStatus } from '@/game/core/Game';
import { PLAYER_APPEARANCES, type PlayerId } from '@/game/entities/Player';
import { AbilityLab } from '@/game/core/AbilityLab';
import AbilityPanel from './AbilityPanel';
import type { RiskSnapshot } from '@/game/risks/RiskWorkflow';
import RepairPuzzle from './RepairPuzzle';
import GameObjectiveHUD from './GameObjectiveHUD';
import OrdersHud from './OrdersHud';
import OrlaTablet, { type AnalystTutorialStep } from './OrlaTablet';
import AnalystTutorialGuide from './AnalystTutorialGuide';
import MobilityTutorialGuide, { type MobilityTutorialStep } from './MobilityTutorialGuide';
import InfrastructureTutorialGuide, { type InfrastructureTutorialStep } from './InfrastructureTutorialGuide';
import type { RepairPuzzleType } from '@/game/session/repairPuzzleTypes';
import { suburbanGameState } from '@/game/core/GameState';

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
  const [storyOpen, setStoryOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerId>(1);
  const isAnalystTablet = isOriginalOrla && selectedPlayer === 3;
  const [closeView, setCloseView] = useState(false);
  const [analystTutorialStep, setAnalystTutorialStep] = useState<AnalystTutorialStep | null>(null);
  const [mobilityTutorialStep, setMobilityTutorialStep] = useState<MobilityTutorialStep | null>(null);
  const [infrastructureTutorialStep, setInfrastructureTutorialStep] = useState<InfrastructureTutorialStep | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [, setRisks] = useState<RiskSnapshot | null>(null);
  const [interactionPrompt, setInteractionPrompt] = useState<string | null>(null);
  const [repairPuzzleOpen, setRepairPuzzleOpen] = useState(false);
  const [repairPuzzleType, setRepairPuzzleType] = useState<RepairPuzzleType>('pole');
  const [testPuzzleType, setTestPuzzleType] = useState<RepairPuzzleType | null>(null);
  const [abilities, setAbilities] = useState(() => new AbilityLab().snapshot());
  const [objectiveDistance, setObjectiveDistance] = useState<number | null>(null);

  useEffect(() => {
    if (!host.current) return;
    let instance: Game;
    try {
      instance = new Game(host.current, value => { setStatus(value); if (value === 'playing') setCloseView(game.current?.isCloseView ?? false); }, setAbilities, setSelectedPlayer, setRisks, setInteractionPrompt, (open, type) => { setRepairPuzzleOpen(open); if (type) setRepairPuzzleType(type); }, setObjectiveDistance);
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
    setStoryOpen(false);
    game.current?.returnToMenu();
    setSceneId('test');
    setRisks(null);
    setSelectedPlayer(1);
    setCloseView(false);
    setAnalystTutorialStep(null);
    setMobilityTutorialStep(null);
    setInfrastructureTutorialStep(null);

    setObjectiveDistance(null);
  };

  const startAnalystTutorial = () => {
    setStoryOpen(false);
    game.current?.startOrlaWithAnalystTutorial();
    setSceneId('fase1-orla');
    setCloseView(false);
    setSelectedPlayer(3);
    setAnalystTutorialStep(0);
  };

  const progressAnalystTutorial = (milestone: 'selected' | 'confirmed' | 'infrastructure' | 'mobility') => {
    const nextStep = analystTutorialStep === 1 && milestone === 'selected' ? 2
      : analystTutorialStep === 2 && milestone === 'confirmed' ? 3
        : analystTutorialStep === 3 && milestone === 'infrastructure' ? 4
          : analystTutorialStep === 4 && milestone === 'mobility' ? 5 : null;
    if (nextStep === null) return;
    game.current?.setAnalystTutorialStep(nextStep);
    setAnalystTutorialStep(nextStep);
  };

  const beginAnalystTutorialSteps = () => {
    game.current?.setAnalystTutorialStep(1);
    setAnalystTutorialStep(1);
  };

  const beginMobilityTutorial = () => {
    game.current?.startMobilityTutorial();
    setAnalystTutorialStep(null);
    setMobilityTutorialStep(0);
  };

  const setMobilityStep = (step: MobilityTutorialStep) => {
    game.current?.setMobilityTutorialStep(step);
    setMobilityTutorialStep(step);
  };

  const finishTeamTutorials = () => {
    setMobilityTutorialStep(null);
    game.current?.startInfrastructureTutorial();
    setInfrastructureTutorialStep(0);
  };

  const setInfrastructureStep = (step: InfrastructureTutorialStep) => {
    game.current?.setInfrastructureTutorialStep(step);
    setInfrastructureTutorialStep(step);
  };

  const finishInfrastructureTutorial = () => {
    game.current?.finishTeamTutorials();
    setInfrastructureTutorialStep(null);
  };

  useEffect(() => {
    if (mobilityTutorialStep === null) return;
    const timer = window.setInterval(() => {
      const snapshot = game.current?.getMobilityTutorialSnapshot();
      if (!snapshot) return;
      if (mobilityTutorialStep === 1 && snapshot.facingConeCrate) setMobilityStep(2);
      else if (mobilityTutorialStep === 3 && snapshot.holdingCone) setMobilityStep(4);
      else if (mobilityTutorialStep === 5 && snapshot.atWorkZone) setMobilityStep(6);
      else if (mobilityTutorialStep === 7 && snapshot.placedCones > 0) setMobilityStep(8);
      else if ([9, 11, 13, 15, 17].includes(mobilityTutorialStep)) {
        const advanced = game.current?.getMobilityTutorialStep();
        if (advanced !== null && advanced !== undefined && advanced > mobilityTutorialStep) setMobilityTutorialStep(advanced as MobilityTutorialStep);
      }
    }, 180);
    return () => window.clearInterval(timer);
  }, [mobilityTutorialStep]);

  useEffect(() => {
    if (infrastructureTutorialStep === null) return;
    const timer = window.setInterval(() => {
      if (infrastructureTutorialStep === 1 && game.current?.getInfrastructureTutorialSnapshot()?.readyToRepair) setInfrastructureStep(2);
      else if (infrastructureTutorialStep === 3) {
        const advanced = game.current?.getInfrastructureTutorialStep();
        if (advanced === 4) setInfrastructureTutorialStep(4);
      }
    }, 180);
    return () => window.clearInterval(timer);
  }, [infrastructureTutorialStep, interactionPrompt]);

  return (
    <section className={`game-shell${isLaboratory ? '' : ' is-orla'}`} aria-label="Suburban — jogo de mobilidade urbana">
      <div ref={host} className="viewport" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>SUBURBAN<small>{isLaboratory ? 'LABORATÓRIO DE HABILIDADES' : 'FASE 1 · ORLA'}</small></span></div>
        <span className="build-label">{isLaboratory ? 'TESTE LIVRE' : 'ORLA ORIGINAL'}</span>
      </header>
      {status === 'ready' && !error && <EntryScreen ready={initialized} onStory={() => setStoryOpen(true)} onLab={() => { game.current?.start(); setSceneId('test'); }} />}
      {(status === 'paused' || error) && (
        <div className="overlay">
          <div ref={panel} className="panel">
            <span className="eyebrow">{error ? 'INICIALIZAÇÃO' : status === 'paused' ? 'UM RESPIRO' : 'O COMEÇO DE UM MUNDO'}</span>
            <h1>{error ? 'Ops, algo falhou.' : status === 'paused' ? 'Jogo pausado.' : <>Como você<br />quer começar<span>?</span></>}</h1>
            <p>{error ?? (status === 'paused' ? 'Sua cena está esperando. Continue quando quiser.' : 'Jogue a fase da Orla ou explore as habilidades e os puzzles na área de testes.')}</p>
            {error ? <button onClick={() => window.location.reload()}>Tentar novamente ↗</button> :
              <button disabled={!initialized} onClick={status === 'ready' ? () => setStoryOpen(true) : event => { game.current?.togglePause(); event.currentTarget.blur(); }}>
                {!initialized ? 'Preparando…' : status === 'paused' ? 'Continuar →' : 'Jogar a fase →'}
              </button>}
            {!error && status === 'ready' && <button className="secondary" disabled={!initialized}
              onClick={event => { game.current?.start(); setSceneId('test'); event.currentTarget.blur(); }}>
              Área de testes →
            </button>}
            {!error && status === 'paused' && <button className="secondary" onClick={returnToMenu}>Voltar ao menu</button>}
            <div className="stack">ANALISAR <i /> ORGANIZAR <i /> REPARAR</div>
          </div>
        </div>
      )}
      {storyOpen && !error && <StoryIntro onComplete={startAnalystTutorial} />}
      {isOriginalOrla && !error && analystTutorialStep === null && mobilityTutorialStep === null && infrastructureTutorialStep === null && <OrdersHud paused={status !== 'playing'} onMenu={returnToMenu} />}
      {isOriginalOrla && repairPuzzleOpen && <RepairPuzzle type={repairPuzzleType} paused={status !== 'playing'} onComplete={() => game.current?.completeRepairPuzzle()} />}
      {isLaboratory && testPuzzleType && <RepairPuzzle key={testPuzzleType} type={testPuzzleType} onComplete={() => setTestPuzzleType(null)} onCancel={() => setTestPuzzleType(null)} />}
      {status === 'playing' && !error && <>
        {isAnalystTablet && <OrlaTablet onAction={id => {
          if (!id || analystTutorialStep !== null) return;
          const problem = suburbanGameState.snapshot().problems.find(item => item.id === id);
          if (problem?.status === 'RESOLVED') game.current?.archiveResolvedProblem(id);
          else if (suburbanGameState.snapshot().selectedProblemId === id) game.current?.interact();
          else game.current?.selectProblem(id);
        }} tutorialStep={analystTutorialStep} onTutorialProgress={progressAnalystTutorial} />}
        {isOriginalOrla && analystTutorialStep !== null && <AnalystTutorialGuide
          step={analystTutorialStep}
          onBegin={beginAnalystTutorialSteps}
          onComplete={beginMobilityTutorial}
        />}
        {isOriginalOrla && mobilityTutorialStep !== null && <MobilityTutorialGuide
          step={mobilityTutorialStep}
          onBegin={() => setMobilityStep(1)}
          onContinue={() => setMobilityStep((mobilityTutorialStep + 1) as MobilityTutorialStep)}
          onComplete={finishTeamTutorials}
        />}
        {isOriginalOrla && infrastructureTutorialStep !== null && <InfrastructureTutorialGuide
          step={infrastructureTutorialStep}
          onBegin={() => setInfrastructureStep(1)}
          onContinue={() => setInfrastructureStep((infrastructureTutorialStep + 1) as InfrastructureTutorialStep)}
          onComplete={finishInfrastructureTutorial}
        />}
        <div className="hud"><span><b>[ {PLAYER_APPEARANCES[selectedPlayer].name.toLocaleUpperCase('pt-BR')} ]</b><small>{analystTutorialStep !== null ? 'TABLET · E CONFIRMAR / ACIONAR EQUIPES' : mobilityTutorialStep !== null ? 'MOBILIDADE · WASD MOVER / E INTERAGIR' : !isLaboratory ? 'WASD · mover / Shift · correr / E · ação / T · trocar' : selectedPlayer === 3 ? 'Mouse · investigar e marcar / T · trocar' : 'WASD · mover / Shift · correr / T · trocar'}</small></span><button className="secondary" onClick={() => game.current?.togglePause()}>Pausar · Esc</button></div>
        {isOriginalOrla && !isAnalystTablet && <GameObjectiveHUD player={selectedPlayer} distance={objectiveDistance} tutorialTarget={infrastructureTutorialStep === 1} />}
        {!isLaboratory && interactionPrompt && <div className={`interaction-prompt${infrastructureTutorialStep === 3 || mobilityTutorialStep === 3 && interactionPrompt === 'PEGAR CONE DO BAÚ' || mobilityTutorialStep === 7 && interactionPrompt === 'SOLTAR CONE NA VIA' ? ' tutorial-focus' : ''}`} role="status"><kbd>E</kbd> {interactionPrompt}</div>}

        {isLaboratory && <AbilityPanel state={abilities} onUse={() => game.current?.useAbility()} onTool={tool => game.current?.setAbilityTool(tool)} onStop={index => game.current?.selectStop(index)} onMap={(point, mark) => game.current?.clickAbilityMap(point, mark)} onInspect={(id, mark) => game.current?.inspectIssue(id, mark)} onReset={() => game.current?.resetAbilities()} />}
        {isLaboratory && <aside className="repair-test-panel" aria-label="Testar quebra-cabeças de reparo">
          <span className="ability-kicker">OFICINA · TESTE ISOLADO</span>
          <h2>Quebra-cabeças</h2>
          <p>Abra qualquer reparo sem iniciar uma ocorrência.</p>
          <div className="repair-test-options">
            {([
              ['pole', 'Poste'], ['signal', 'Semáforo'], ['crossing', 'Travessia'], ['traffic', 'Fluxo de vias'],
              ['sensor', 'Sensor'], ['car', 'Veículo'],
            ] as const).map(([type, label]) => <button key={type} type="button" onClick={() => setTestPuzzleType(type)}>{label}</button>)}
          </div>
        </aside>}
        {analystTutorialStep === null && mobilityTutorialStep === null && infrastructureTutorialStep === null && <div className="character-selector" role="group" aria-label="Escolher personagem">
          {playerIds.map(id => <button key={id} aria-pressed={selectedPlayer === id}
            onClick={event => { game.current?.selectPlayer(id); event.currentTarget.blur(); }}>
            <span className="character-color" style={{ backgroundColor: PLAYER_APPEARANCES[id].shirt }} aria-hidden="true" />
            {PLAYER_APPEARANCES[id].name}
          </button>)}
          <button aria-pressed={closeView} onClick={() => { game.current?.setCloseView(!closeView); setCloseView(!closeView); }}>
            {closeView ? 'Visão ampla' : 'Ver de perto'}
          </button>

        </div>}
        {isOriginalOrla && !repairPuzzleOpen && analystTutorialStep === null && (infrastructureTutorialStep === null || infrastructureTutorialStep === 3) && (mobilityTutorialStep === null || mobilityTutorialStep === 3 || mobilityTutorialStep === 7 || [9, 11, 13, 15, 17].includes(mobilityTutorialStep)) && <div className="orla-actions" role="group" aria-label="Ações da equipe">
          <button disabled={mobilityTutorialStep !== null && mobilityTutorialStep !== 3 && mobilityTutorialStep !== 7} className={mobilityTutorialStep === 3 || mobilityTutorialStep === 7 || infrastructureTutorialStep === 3 ? 'tutorial-focus' : undefined} data-tutorial-target={mobilityTutorialStep === 3 || mobilityTutorialStep === 7 || infrastructureTutorialStep === 3 ? 'true' : undefined} onClick={event => { game.current?.interact(); event.currentTarget.blur(); }}><kbd>E</kbd> {selectedPlayer === 3 ? 'Acionar equipe' : selectedPlayer === 2 ? 'Cone' : 'Interagir'}</button>
          {selectedPlayer === 2 && ['Liberar via', 'Bloquear sentido', 'Interditar tudo', 'Via de escape'].map((label, index) => {
            const activeSkill = mobilityTutorialStep !== null && mobilityTutorialStep === 9 ? 0 : mobilityTutorialStep === 11 ? 1 : mobilityTutorialStep === 13 ? 2 : mobilityTutorialStep === 15 ? 3 : mobilityTutorialStep === 17 ? 0 : -1;
            const target = activeSkill === index;
            const locked = mobilityTutorialStep !== null && !target;
            return <button key={label} disabled={locked} className={target ? 'tutorial-focus' : undefined} data-tutorial-target={target ? 'true' : undefined} onClick={event => { game.current?.useMobilityHotkey(`Digit${index + 1}`); event.currentTarget.blur(); }}><kbd>{index + 1}</kbd> {label}</button>;
          })}
        </div>}
        {(isOriginalOrla && selectedPlayer !== 3 || (isLaboratory && selectedPlayer !== 3 && !abilities.editing)) && <div data-tutorial-target={mobilityTutorialStep === 1 || mobilityTutorialStep === 5 || infrastructureTutorialStep === 1 ? 'true' : undefined} className={`touch-controls${isLaboratory ? '' : ' orla-touch-controls'}${mobilityTutorialStep === 1 || mobilityTutorialStep === 5 || infrastructureTutorialStep === 1 ? ' tutorial-focus' : ''}`} aria-label="Controles de movimento">
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


