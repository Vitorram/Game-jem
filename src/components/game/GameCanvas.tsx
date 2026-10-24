'use client';

import { useEffect, useRef, useState } from 'react';
import StoryIntro from './StoryIntro';
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
import { useGameAudio } from '@/game/audio/useGameAudio';
import AudioControls from '../audio/AudioControls';

import { gameMusic } from '@/game/audio/musicManager';
import { coopRoleToPlayerId, coopTeamMode, getCoopClient, type CoopMessage, type CoopPlayer, type CoopRole } from '@/game/coop/CoopClient';


const playerIds: PlayerId[] = [1, 2, 3];
type CoopSession = { room: string; playerId: string; role: CoopRole; name: string; serverUrl: string; players?: CoopPlayer[]; sharedAnalyst: boolean };
const roleTitle = (role: CoopRole) => role === 'analista' ? 'Analista' : role === 'mobilidade' ? 'Mobilidade' : 'Infraestrutura';

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
  const coopClient = useRef<ReturnType<typeof getCoopClient> | null>(null);
  const coopRef = useRef<CoopSession | null>(null);
  const suppressRemotePause = useRef(false);
  const statusRef = useRef<GameStatus>('ready');
  const [coopSession, setCoopSession] = useState<CoopSession | null>(null);
  const [coopRoster, setCoopRoster] = useState<CoopPlayer[]>([]);
  const [coopTutorialWaiting, setCoopTutorialWaiting] = useState(false);
  const [coopTutorialReady, setCoopTutorialReady] = useState(false);
  const [coopFailure, setCoopFailure] = useState(false);
  const [sceneId, setSceneId] = useState<GameSceneId>('test');
  const isLaboratory = sceneId === 'test';
  const isOriginalOrla = sceneId === 'fase1-orla';
  const [status, setStatus] = useState<GameStatus>('ready');
  const [initialized, setInitialized] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerId>(1);
  const [analystTabletOpen, setAnalystTabletOpen] = useState(false);
  // Em dupla não há Analista: Mobilidade e Infraestrutura têm o próprio tablet da central.
  const sharedAnalyst = !!coopSession?.sharedAnalyst;
  const hasAnalystTablet = isOriginalOrla && (selectedPlayer === 3 || sharedAnalyst);
  const isAnalystTablet = hasAnalystTablet && analystTabletOpen;
  const [closeView, setCloseView] = useState(false);
  const [analystAttention, setAnalystAttention] = useState(false);
  const [analystTutorialStep, setAnalystTutorialStep] = useState<AnalystTutorialStep | null>(null);
  const [mobilityTutorialStep, setMobilityTutorialStep] = useState<MobilityTutorialStep | null>(null);
  const [infrastructureTutorialStep, setInfrastructureTutorialStep] = useState<InfrastructureTutorialStep | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [, setRisks] = useState<RiskSnapshot | null>(null);
  const [interactionPrompt, setInteractionPrompt] = useState<string | null>(null);
  const [repairPuzzleOpen, setRepairPuzzleOpen] = useState(false);
  const [repairPuzzleType, setRepairPuzzleType] = useState<RepairPuzzleType>('pole');
  const [testPuzzleType, setTestPuzzleType] = useState<RepairPuzzleType | null>(null);
  const [pauseSettingsOpen, setPauseSettingsOpen] = useState(false);
  const [abilities, setAbilities] = useState(() => new AbilityLab().snapshot());
  const [objectiveDistance, setObjectiveDistance] = useState<number | null>(null);
  coopRef.current = coopSession;
  const failCoop = (message: string) => {
    setCoopFailure(true);
    suppressRemotePause.current = true;
    if (statusRef.current === 'playing') game.current?.togglePause();
    suppressRemotePause.current = false;
    setError(message);
  };

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('suburban-coop-session');
      if (saved) {
        setCoopFailure(true);
        const session = JSON.parse(saved);
        const client = getCoopClient();
        const currentRoom = client.currentRoom;
        const currentPlayer = currentRoom?.players.find(player => player.id === session?.playerId);
        if (!session || !client.hasSession(session.playerId, session.room)
          || !currentRoom || currentRoom.phase === 'lobby' || !currentPlayer || currentPlayer.role !== session.role) {
          sessionStorage.removeItem('suburban-coop-session');
          setError('A sessão coop expirou. Volte às salas para reunir sua equipe.');
          return;
        }
        setCoopSession({
          room: currentRoom.code, playerId: currentPlayer.id, role: currentPlayer.role,
          name: currentPlayer.name, serverUrl: client.url, players: currentRoom.players,
          // O servidor decide o modo no início; o roster serve de reserva se a mensagem não o trouxer.
          sharedAnalyst: currentRoom.sharedAnalyst ?? coopTeamMode(currentRoom.players) === 'duo',
        });
      }
    } catch { setError('Não foi possível recuperar a sessão. Volte ao menu para começar novamente.'); }
  }, []);

  useEffect(() => {
    if (!coopSession) return;
    setCoopRoster(coopSession.players ?? []);
    const client = getCoopClient(coopSession.serverUrl);
    coopClient.current = client;
    let ready = true;
    let tutorialTimer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (message: CoopMessage) => {
      if (!ready) return;
      if (message.type === 'move') game.current?.applyCoopPose(message.role, message.x, message.z, message.yaw);
      else if (message.type === 'action') game.current?.applyCoopAction(message.role, message.action);
      else if (message.type === 'room') setCoopRoster(message.players);
      else if (message.type === 'tutorial-start') {
        clearTimeout(tutorialTimer);
        tutorialTimer = setTimeout(() => {
          if (!ready || !client.hasSession(coopSession.playerId, coopSession.room)) return;
          game.current?.finishCoopTutorial();
          setCoopTutorialWaiting(false);
          setCoopTutorialReady(false);
          if (statusRef.current === 'paused') client.pause(true);
        }, message.startDelayMs);
      } else if (message.type === 'pause' && game.current) {
        suppressRemotePause.current = true;
        if ((message.paused && statusRef.current === 'playing') || (!message.paused && statusRef.current === 'paused')) game.current.togglePause();
        suppressRemotePause.current = false;
      } else if (message.type === 'error') client.disconnect(message.message);
      else if (message.type === 'session-ended' || message.type === 'connection' && message.state === 'disconnected') {
        clearTimeout(tutorialTimer);
        sessionStorage.removeItem('suburban-coop-session');
        failCoop(message.message || 'Conexão perdida. Volte às salas para jogar novamente.');
      }
      else if (message.type === 'peer-left') setCoopRoster(players => players.filter(player => player.id !== message.id));
    };
    client.on(onMessage);
    if (!client.hasSession(coopSession.playerId, coopSession.room)) failCoop('A sessão não está conectada. Volte às salas.');
    return () => { ready = false; client.off(onMessage); clearTimeout(tutorialTimer); };
  }, [coopSession]);

  useEffect(() => {
    if (!host.current) return;
    let instance: Game;
    try {
      instance = new Game(host.current, value => {
        statusRef.current = value;
        setStatus(value);
        if (value === 'playing') setCloseView(game.current?.isCloseView ?? false);
        if (coopRef.current && !suppressRemotePause.current && (value === 'paused' || value === 'playing')) coopClient.current?.pause(value === 'paused');
      }, setAbilities, setSelectedPlayer, setRisks, setInteractionPrompt, (open, type) => { setRepairPuzzleOpen(open); if (type) setRepairPuzzleType(type); }, setObjectiveDistance, action => coopClient.current?.action(action), setAnalystTabletOpen);
      game.current = instance;
      setInitialized(true);
    } catch (cause) {
      console.error('Falha ao inicializar o jogo:', cause);
      setError('Não foi possível iniciar o 3D. Verifique se a aceleração gráfica está habilitada e recarregue a página.');
      return;
    }
    return () => { instance.dispose(); game.current = null; };
  }, []);

  useEffect(() => {
    if (initialized && status === 'ready' && !error) setStoryOpen(true);
  }, [initialized, status, error]);

  useEffect(() => {
    if (status !== 'playing' && status !== 'paused') return;

    const confirmLeavingDuringGame = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', confirmLeavingDuringGame);
    return () => window.removeEventListener('beforeunload', confirmLeavingDuringGame);
  }, [status]);

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
    getCoopClient().disconnect();
    sessionStorage.removeItem('suburban-coop-session');
    window.location.assign('/');
  };

  const startAnalystTutorial = () => {
    setStoryOpen(false);
    if (coopSession) {
      clientTutorialOpen();
      game.current?.startCoopOrlaTutorial(coopRoleToPlayerId(coopSession.role), { sharedAnalyst: coopSession.sharedAnalyst });
      setCoopTutorialWaiting(true);
      setSelectedPlayer(coopRoleToPlayerId(coopSession.role));
    } else {
      game.current?.startOrlaWithAnalystTutorial();
      setSelectedPlayer(3);
      setAnalystTutorialStep(0);
    }
    setSceneId('fase1-orla');
    setCloseView(false);
  };

  const clientTutorialOpen = () => {
    void coopClient.current?.tutorialOpen().catch(cause => failCoop(cause instanceof Error ? cause.message : 'Não foi possível iniciar o tutorial.'));
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

  useEffect(() => {
    if (!isOriginalOrla) return;
    // Lembrete no botão da Analista quando há chamado esperando por ela e o jogador está em outra equipe.
    const timer = window.setInterval(() => setAnalystAttention(game.current?.analystNeedsAttention() ?? false), 400);
    return () => { window.clearInterval(timer); setAnalystAttention(false); };
  }, [isOriginalOrla]);

  const tutorialOpen = analystTutorialStep !== null || mobilityTutorialStep !== null || infrastructureTutorialStep !== null;
  useGameAudio({ screen: 'game', status, preparing: !initialized || storyOpen || tutorialOpen || sceneId !== 'fase1-orla', error: !!error });

  useEffect(() => {
    if (!coopSession || !coopClient.current || status !== 'playing' || coopTutorialWaiting) return;
    const timer = window.setInterval(() => {
      const pose = game.current?.getCoopPose();
      if (pose) coopClient.current?.move(coopSession.role, pose.x, pose.z, pose.yaw);
    }, 80);
    return () => window.clearInterval(timer);
  }, [coopSession, status, coopTutorialWaiting]);

  useEffect(() => {
    if (!tutorialOpen) return;
    // Atalho para pular o treino; Esc continua sendo pausa.
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'KeyP' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      skipTutorial();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const skipTutorial = () => {
    game.current?.skipTutorial();
    setAnalystTutorialStep(null);
    setMobilityTutorialStep(null);
    setInfrastructureTutorialStep(null);
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

  const promptClassName = `interaction-prompt${infrastructureTutorialStep === 3 || mobilityTutorialStep === 3 && interactionPrompt === 'PEGAR CONE DO BAÚ' || mobilityTutorialStep === 7 && interactionPrompt === 'SOLTAR CONE NA VIA' ? ' tutorial-focus' : ''}`;
  const promptIsInstruction = !!interactionPrompt && (/USE [1-4]/.test(interactionPrompt)
    || interactionPrompt.startsWith('AGUARDE') || interactionPrompt.startsWith('DESVIO'));

  return (
    <section className={`game-shell${isLaboratory ? '' : ' is-orla'}`} aria-label="Suburban — jogo de mobilidade urbana">
      <div ref={host} className="viewport" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>SUBURBAN<small>{isLaboratory ? 'LABORATÓRIO DE HABILIDADES' : 'FASE 1 · ORLA'}</small></span></div>
        <span className="build-label">{isLaboratory ? 'TESTE LIVRE' : 'ORLA ORIGINAL'}</span>
      </header>
      {status === 'ready' && !error && !storyOpen && <div className="game-preparing-screen" role="status">PREPARANDO A CIDADE…</div>}
      {(status === 'paused' || error) && (
        <div className={`overlay${status === 'paused' && !error ? ' pause-overlay' : ''}`}>
          <div ref={panel} className="panel">
            <span className="eyebrow">{error ? coopFailure ? 'CONEXÃO COOP' : 'INICIALIZAÇÃO' : status === 'paused' ? 'SUBURBAN · ORLA' : 'O COMEÇO DE UM MUNDO'}</span>
            <h1>{error ? 'Ops, algo falhou.' : status === 'paused' ? <>Pausa<span>.</span></> : <>Como você<br />quer começar<span>?</span></>}</h1>
            <p>{error ?? (status === 'paused' ? pauseSettingsOpen ? 'CONTROLES\nWASD ou setas · mover\nE ou clique · interagir\nT · trocar personagem\nEsc · pausar e continuar' : '' : 'Jogue a fase da Orla ou explore as habilidades e os puzzles na área de testes.')}</p>
            {error ? <button onClick={() => {
              if (!coopFailure) { window.location.reload(); return; }
              getCoopClient().disconnect(); sessionStorage.removeItem('suburban-coop-session'); window.location.assign('/coop');
            }}>{coopFailure ? 'Voltar às salas ↗' : 'Tentar novamente ↗'}</button> :
              <button onClick={event => { game.current?.togglePause(); event.currentTarget.blur(); }}>Continuar →</button>}
            {!error && status === 'paused' && <div className="pause-actions">
              <button className="pause-secondary" onClick={returnToMenu}>Sair</button>
              <button className="pause-secondary" onClick={() => setPauseSettingsOpen(value => !value)}>{pauseSettingsOpen ? 'Fechar configurações' : 'Configurações'}</button>
            </div>}
            {!error && status === 'paused' && pauseSettingsOpen && <AudioControls />}
            {status !== 'paused' && <div className="stack">ANALISAR <i /> ORGANIZAR <i /> REPARAR</div>}
          </div>
        </div>
      )}
      {storyOpen && !error && <StoryIntro onComplete={startAnalystTutorial} />}
      {coopTutorialWaiting && coopSession && status !== 'paused' && <div className="coop-tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="coop-tutorial-title">
        <section className="coop-tutorial-card">
          <span className="eyebrow">TUTORIAL COLETIVO · SALA {coopSession.room}</span>
          <h2 id="coop-tutorial-title">Sua equipe: {roleTitle(coopSession.role)}{sharedAnalyst ? ' + Analista' : ''}</h2>
          {coopSession.role === 'analista' ? <p>WASD move você e Shift corre. Pressione Q ou toque em Abrir tablet para analisar chamados e coordenar as equipes. Você fica parada no local enquanto usa o tablet; guarde com Q para voltar a andar. O trânsito e o relógio continuam.</p>
            : coopSession.role === 'mobilidade' ? <p>WASD move você, Shift corre e E interage. Organize o trânsito, proteja a área de trabalho e mantenha a ciclovia segura.</p>
              : <p>WASD move você, Shift corre e E interage. Vá até os equipamentos chamados e conclua os reparos quando a área estiver protegida.</p>}
          {sharedAnalyst && <p className="coop-tutorial-shared">Partida em dupla: vocês duas dividem a central da Analista. Q abre e guarda o seu tablet; com ele aberto, E analisa o chamado e 1 / 2 acionam Infraestrutura e Mobilidade. O que uma de vocês concluir aparece no tablet da outra, e abrir o tablet não trava a parceira.</p>}
          <p className="coop-tutorial-note">A partida e os chamados só começam quando {sharedAnalyst ? 'as duas pessoas' : 'todas as pessoas'} da sala confirmarem que entenderam seu papel.</p>
          <button type="button" className="coop-tutorial-ready" disabled={coopTutorialReady} onClick={() => {
            setCoopTutorialReady(true);
            void coopClient.current?.tutorialReady(true).catch(cause => { setCoopTutorialReady(false); failCoop(cause instanceof Error ? cause.message : 'Não foi possível confirmar o tutorial.'); });
          }}>{coopTutorialReady ? 'Pronta · aguardando equipe…' : 'Entendi · estou pronta'}</button>
        </section>
      </div>}
      {coopSession && !coopTutorialWaiting && <aside className="coop-team-hud" aria-label="Equipe cooperativa">
        <b>COOP · {coopSession.room}</b>
        {coopRoster.map(member => <span key={member.id} className={member.id === coopSession.playerId ? 'is-you' : ''}>{member.name} · {roleTitle(member.role)}</span>)}
        {sharedAnalyst && <span className="is-shared">Analista · tablet compartilhado</span>}
      </aside>}
      {isOriginalOrla && !coopTutorialWaiting && !error && analystTutorialStep === null && mobilityTutorialStep === null && infrastructureTutorialStep === null && <OrdersHud paused={status !== 'playing'} onMenu={returnToMenu} onContinue={() => game.current?.togglePause()} onRestart={coopSession ? returnToMenu : undefined} />}
      {isOriginalOrla && repairPuzzleOpen && <RepairPuzzle type={repairPuzzleType} paused={status !== 'playing'} onComplete={() => game.current?.completeRepairPuzzle()} />}
      {isLaboratory && testPuzzleType && <RepairPuzzle key={testPuzzleType} type={testPuzzleType} onComplete={() => setTestPuzzleType(null)} onCancel={() => setTestPuzzleType(null)} />}
      {status === 'playing' && !error && <>
        {isAnalystTablet && <OrlaTablet onAnalyze={id => game.current?.analyzeProblem(id)} onCallTow={id => game.current?.callTow(id) ?? false} onAction={id => {
          if (!id) return;
          if (analystTutorialStep !== null) {
            if (analystTutorialStep === 2) game.current?.analyzeProblem(id);
            else if (analystTutorialStep === 3) game.current?.dispatchTeam('infraestrutura');
            else if (analystTutorialStep === 4) game.current?.dispatchTeam('mobilidade');
            return;
          }
          const problem = suburbanGameState.snapshot().problems.find(item => item.id === id);
          if (problem?.status === 'RESOLVED') game.current?.archiveResolvedProblem(id);
          else if (!problem?.analyzed) game.current?.analyzeProblem(id);
          else game.current?.requestReinforcements(id);
        }} tutorialStep={analystTutorialStep} onTutorialProgress={progressAnalystTutorial} onClose={analystTutorialStep === null ? () => game.current?.toggleAnalystTablet() : undefined}
          operator={sharedAnalyst && coopSession ? `${roleTitle(coopSession.role).toLocaleUpperCase('pt-BR')} · CENTRAL COMPARTILHADA` : undefined} />}
        {isOriginalOrla && analystTutorialStep !== null && <AnalystTutorialGuide
          step={analystTutorialStep}
          onBegin={beginAnalystTutorialSteps}
          onComplete={beginMobilityTutorial}
          onSkip={skipTutorial}
        />}
        {isOriginalOrla && mobilityTutorialStep !== null && <MobilityTutorialGuide
          step={mobilityTutorialStep}
          onBegin={() => setMobilityStep(1)}
          onContinue={() => setMobilityStep((mobilityTutorialStep + 1) as MobilityTutorialStep)}
          onComplete={finishTeamTutorials}
          onSkip={skipTutorial}
        />}
        {isOriginalOrla && infrastructureTutorialStep !== null && <InfrastructureTutorialGuide
          step={infrastructureTutorialStep}
          onBegin={() => setInfrastructureStep(1)}
          onContinue={() => setInfrastructureStep((infrastructureTutorialStep + 1) as InfrastructureTutorialStep)}
          onComplete={finishInfrastructureTutorial}
          onSkip={skipTutorial}
        />}
        <div className="hud"><span><b>[ {PLAYER_APPEARANCES[selectedPlayer].name.toLocaleUpperCase('pt-BR')} ]</b><small>{analystTutorialStep !== null ? 'TABLET · E / CLIQUE CONFIRMAR / ACIONAR EQUIPES' : isOriginalOrla && selectedPlayer === 3 ? isAnalystTablet ? 'PARADA · Q guardar tablet / E ou clique · ação' : 'WASD · mover / Shift · correr / Q · abrir tablet'
          : sharedAnalyst && isAnalystTablet ? 'TABLET · Q guardar / E analisar / 1 · 2 acionar equipes'
            : sharedAnalyst ? 'WASD · mover / Shift · correr / E · ação / Q · tablet da central' : mobilityTutorialStep !== null ? 'MOBILIDADE · WASD MOVER / E / CLIQUE INTERAGIR' : !isLaboratory ? 'WASD · mover / Shift · correr / E ou clique · ação / T · trocar' : selectedPlayer === 3 ? 'Mouse · investigar e marcar / T · trocar' : 'WASD · mover / Shift · correr / T · trocar'}</small></span><button className="secondary" onClick={() => game.current?.togglePause()}>Pausar · Esc</button></div>
        {isOriginalOrla && !isAnalystTablet && <GameObjectiveHUD player={selectedPlayer} distance={objectiveDistance} tutorialTarget={infrastructureTutorialStep === 1} />}
        {/* Com o tablet aberto em dupla, E/clique pertence à central: os avisos de campo voltam ao guardar. */}
        {!isLaboratory && interactionPrompt && (selectedPlayer === 3 ? isAnalystTablet : !isAnalystTablet) && (promptIsInstruction
          ? <div className={`${promptClassName} is-hotkey-hint`} role="status">{interactionPrompt}</div>
          : <button type="button" className={promptClassName} onClick={event => { game.current?.interact(); event.currentTarget.blur(); }} aria-label={`Interagir: ${interactionPrompt}`}><kbd>E</kbd> / clique {interactionPrompt}</button>)}

        {isLaboratory && <AbilityPanel state={abilities} onUse={() => game.current?.useAbility()} onTool={tool => game.current?.setAbilityTool(tool)} onStop={index => game.current?.selectStop(index)} onMap={(point, mark) => game.current?.clickAbilityMap(point, mark)} onInspect={(id, mark) => game.current?.inspectIssue(id, mark)} onReset={() => game.current?.resetAbilities()} />}
        {isLaboratory && <aside className="repair-test-panel" aria-label="Testar quebra-cabeças de reparo">
          <span className="ability-kicker">OFICINA · TESTE ISOLADO</span>
          <h2>Quebra-cabeças</h2>
          <p>Abra qualquer reparo sem iniciar uma ocorrência.</p>
          <div className="repair-test-options">
            {([
              ['pole', 'Poste · circuito'], ['signal', 'Semáforo · cabos'], ['sensor', 'Sensor · sincronização'],
              ['signal-check', 'Controlador · calibração'], ['car', 'Colisão · segurança'], ['charger', 'Carregador · elétrico'],
            ] as const).map(([type, label]) => <button key={type} type="button" onClick={() => setTestPuzzleType(type)}>{label}</button>)}
          </div>
        </aside>}
        {!coopSession && analystTutorialStep === null && mobilityTutorialStep === null && infrastructureTutorialStep === null && <div className="character-selector" role="group" aria-label="Escolher personagem">
          {playerIds.map(id => <button key={id} aria-pressed={selectedPlayer === id} disabled={isOriginalOrla && !game.current?.canSelectPlayer(id)}
            className={id === 3 && analystAttention ? 'needs-attention' : undefined}
            aria-label={id === 3 && analystAttention ? `${PLAYER_APPEARANCES[id].name} · chamado aguardando` : undefined}
            onClick={event => { game.current?.selectPlayer(id); event.currentTarget.blur(); }}>
            <span className="character-color" style={{ backgroundColor: PLAYER_APPEARANCES[id].shirt }} aria-hidden="true" />
            {PLAYER_APPEARANCES[id].name}
          </button>)}
          <button aria-pressed={closeView} onClick={() => { game.current?.setCloseView(!closeView); setCloseView(!closeView); }}>
            {closeView ? 'Visão ampla' : 'Ver de perto'}
          </button>

        </div>}
        {isOriginalOrla && !isAnalystTablet && !repairPuzzleOpen && analystTutorialStep === null && (infrastructureTutorialStep === null || infrastructureTutorialStep === 3) && (mobilityTutorialStep === null || mobilityTutorialStep === 3 || mobilityTutorialStep === 7 || [9, 11, 13, 15, 17].includes(mobilityTutorialStep)) && <div className="orla-actions" role="group" aria-label="Ações da equipe">
          {hasAnalystTablet && <button type="button" className={`analyst-tablet-toggle${analystAttention ? ' needs-attention' : ''}`} aria-expanded={isAnalystTablet} aria-controls="analyst-tablet" aria-keyshortcuts="Q" disabled={coopTutorialWaiting} onClick={event => { game.current?.toggleAnalystTablet(); event.currentTarget.blur(); }}>
            <kbd>Q</kbd> {isAnalystTablet ? 'Guardar tablet' : 'Abrir tablet'}
            {!isAnalystTablet && analystAttention && <span className="tablet-alert-dot" aria-label="Chamado aguardando" />}
          </button>}
          {selectedPlayer !== 3 && <button disabled={mobilityTutorialStep !== null && mobilityTutorialStep !== 3 && mobilityTutorialStep !== 7} className={mobilityTutorialStep === 3 || mobilityTutorialStep === 7 || infrastructureTutorialStep === 3 ? 'tutorial-focus' : undefined} data-tutorial-target={mobilityTutorialStep === 3 || mobilityTutorialStep === 7 || infrastructureTutorialStep === 3 ? 'true' : undefined} onClick={event => { game.current?.interact(); event.currentTarget.blur(); }}><kbd>E</kbd> {selectedPlayer === 2 ? 'Cone' : 'Interagir'}</button>}

          {selectedPlayer === 2 && ['Liberar via', 'Bloquear sentido', 'Interditar tudo', 'Habilidade 4 · Desviar elétricos'].map((label, index) => {
            const activeSkill = mobilityTutorialStep !== null && mobilityTutorialStep === 9 ? 0 : mobilityTutorialStep === 11 ? 1 : mobilityTutorialStep === 13 ? 2 : mobilityTutorialStep === 15 ? 3 : mobilityTutorialStep === 17 ? 0 : -1;
            const target = activeSkill === index;
            const locked = mobilityTutorialStep !== null && !target;
            return <button key={label} disabled={locked} className={target ? 'tutorial-focus' : undefined} data-tutorial-target={target ? 'true' : undefined} onClick={event => { game.current?.useMobilityHotkey(`Digit${index + 1}`); event.currentTarget.blur(); }}>{index < 3 && <kbd>{index + 1}</kbd>} {label}</button>;
          })}
        </div>}
        {(isOriginalOrla && !isAnalystTablet && !coopTutorialWaiting || (isLaboratory && selectedPlayer !== 3 && !abilities.editing)) && <div data-tutorial-target={mobilityTutorialStep === 1 || mobilityTutorialStep === 5 || infrastructureTutorialStep === 1 ? 'true' : undefined} className={`touch-controls${isLaboratory ? '' : ' orla-touch-controls'}${mobilityTutorialStep === 1 || mobilityTutorialStep === 5 || infrastructureTutorialStep === 1 ? ' tutorial-focus' : ''}`} aria-label="Controles de movimento">
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
      <footer className="bottom-bar"><span>{isAnalystTablet ? 'TABLET ABERTO' : isLaboratory && selectedPlayer === 3 ? 'MOUSE' : 'WASD / SETAS'} <small>{isAnalystTablet ? 'PARADA · MUNDO EM MOVIMENTO' : isLaboratory && selectedPlayer === 3 ? 'ANALISAR' : 'MOVER · SHIFT CORRER'}</small></span><span>ESC <small>PAUSAR</small></span><span className="prototype-label">{isLaboratory ? 'HABILIDADES · SEM MISSÃO' : 'FASE 1 · ORLA'}</span></footer>
    </section>
  );
}



