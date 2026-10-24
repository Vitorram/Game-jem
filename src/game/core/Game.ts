import {
  WebGLRenderer,
  PerspectiveCamera,
  PCFShadowMap,
  Vector3,
} from 'three';

import { gsap } from 'gsap';
import { Input } from './Input';
import { TestScene } from '../scenes/TestScene';
import { Fase1OrlaScene } from '../scenes/Fase1OrlaScene';
import { SceneManager } from './SceneManager';
import { GAME_CONFIG } from '../config';
import { suburbanGameState } from './GameState';
import { GameSession } from '../session/GameSession';
import { sessionStore } from '../session/sessionStore';
import { ORLA_SESSION_CONFIG } from '../session/sessionData';
import type { RiskSnapshot } from '../risks/RiskWorkflow';
import type { PlayerId } from '../entities/Player';
import type { AbilitySnapshot, InfraTool, MapPoint } from './AbilityLab';
import type { ResponseTeam } from './GameState';
import type { RepairPuzzleType } from '../session/repairPuzzleTypes';
import type { CoopAction, CoopRole } from '../coop/CoopClient';

export type GameSceneId = 'test' | 'fase1-orla';
export type GameStatus = 'ready' | 'playing' | 'paused' | 'finished';

/** Ações da central de análise: no coop remoto quem as executa é a Analista (3), não a personagem de quem enviou. */
const ANALYST_ACTIONS: ReadonlySet<CoopAction['type']> = new Set(['analyze', 'dispatch', 'archive', 'call-tow', 'problem-select']);
const ANALYST_ID: PlayerId = 3;
/** Quanto uma ação remota da central espera pelo chamado local antes de ser descartada. */
const DEFERRED_ACTION_MS = 15_000;
/** Tolerância para a simulação local resolver sozinha um chamado que a parceira já arquivou. */
const ARCHIVE_CONVERGENCE_MS = 4_000;

export class Game {
  readonly input: Input;

  private renderer: WebGLRenderer;
  private camera = new PerspectiveCamera(GAME_CONFIG.cameraFov, 1, GAME_CONFIG.cameraNear, GAME_CONFIG.cameraFar);
  private readonly scenes = new SceneManager();

  private get world(): TestScene | undefined {
    const current = this.scenes.current;
    return current instanceof TestScene ? current : undefined;
  }
  private resizeObserver: ResizeObserver;
  private intro?: gsap.core.Tween;
  private orlaIntro?: gsap.core.Tween;
  private readonly orlaIntroOffset = { value: 0 };
  private closeView = false;
  get isCloseView(): boolean { return this.closeView; }
  private readonly cameraTarget = new Vector3(0, 0, 0);
  private readonly desiredPosition = new Vector3();
  private readonly desiredTarget = new Vector3();

  private status: GameStatus = 'ready';
  private repairPuzzleOpen = false;
  private analystTabletOpen = false;
  get isAnalystTabletOpen(): boolean { return this.analystTabletOpen; }
  private activeRepairType: RepairPuzzleType = 'pole';
  private remoteRepairType: RepairPuzzleType | null = null;
  private mandatoryTutorialActive = false;
  private tutorialStage = 0;
  private coopPlayerId: PlayerId | null = null;
  private coopTutorialActive = false;
  /** Partida em dupla: Mobilidade e Infraestrutura também operam o tablet da Analista. */
  private sharedAnalyst = false;
  get hasSharedAnalyst(): boolean { return this.sharedAnalyst; }
  private applyingCoopAction = false;
  private readonly deferredCoopActions: { role: CoopRole; action: CoopAction; queuedAt: number; expiresAt: number }[] = [];
  private previousTime: number | null = null;
  private coopAccumulatorMs = 0;
  private backgroundTimer: ReturnType<typeof setInterval> | null = null;
  private get simulating(): boolean {
    return this.status === 'playing' || (this.coopPlayerId !== null && this.status === 'paused');
  }
  private session?: GameSession;
  private disposed = false;
  private idleRendered = false;
  private readonly observedCallIds = new Set<string>();
  private pendingAnalystSelection = false;
  /** Chamados resolvidos que já selecionaram a Analista uma vez para arquivar. */
  private readonly promptedArchiveIds = new Set<string>();

  constructor(
    private host: HTMLElement,
    private onStatus: (status: GameStatus) => void,
    private onAbilities?: (state: AbilitySnapshot) => void,
    private onPlayerSelected?: (id: PlayerId) => void,
    private onRisks?: (state: RiskSnapshot) => void,
    private onInteractionPrompt?: (prompt: string | null) => void,
    private onRepairPuzzleChange?: (open: boolean, type?: RepairPuzzleType) => void,
    private onObjectiveDistance?: (distance: number | null) => void,
    private onCoopAction?: (action: CoopAction) => void,
    private onAnalystTabletChange?: (open: boolean) => void,
  ) {
    this.renderer = new WebGLRenderer({
      antialias: true,
    });

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.renderer.domElement.setAttribute(
      'aria-label',
      'Cenário 3D com três personagens jogáveis',
    );

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);

    this.host.appendChild(this.renderer.domElement);

    // O input pertence ao Game e é injetado no laboratório.
    this.input = new Input();
    const laboratory = new TestScene(this.onAbilities, this.input);
    this.scenes.setScene(laboratory);
    this.onAbilities?.(laboratory.abilities.snapshot());

    // Vista superior inclinada, com a frente das personagens visível.
    this.camera.up.set(0, 1, 0);
    const introHeight = GAME_CONFIG.cameraHeight + 4;
    this.camera.position.set(0, introHeight, introHeight * GAME_CONFIG.cameraTilt);
    this.camera.lookAt(this.cameraTarget);

    // Ajusta o cenário quando o tamanho da tela muda.
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.host);

    this.resize();

    // Pausa quando a aba perde visibilidade ou foco.
    document.addEventListener(
      'visibilitychange',
      this.onVisibility,
    );

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onBlur);

    // Inicia o ciclo de renderização.
    this.renderer.setAnimationLoop(this.tick);
    // RAF is suspended in hidden tabs. This fallback never renders or reads input.
    this.backgroundTimer = setInterval(() => {
      if (document.hidden && this.coopPlayerId !== null) this.tick(performance.now());
    }, 50);
  }

  private resize = () => {
    if (this.disposed) return;

    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);

    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        GAME_CONFIG.maxPixelRatio,
      ),
    );

    this.renderer.setSize(width, height);
    this.idleRendered = false;

    this.camera.aspect = width / height;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.configureCamera(this.camera, this.camera.aspect, this.closeView);
    else this.camera.updateProjectionMatrix();
  };

  start(sceneId: GameSceneId = 'test', cooperativeWaitingTutorial = false) {
    if (this.status !== 'ready' || this.disposed) return;

    if (sceneId === 'fase1-orla') {
      this.observedCallIds.clear();
      this.promptedArchiveIds.clear();
      this.pendingAnalystSelection = false;
      suburbanGameState.reset();
      const orla = new Fase1OrlaScene(this.input, this.onRisks, this.onInteractionPrompt, type => this.openRepairPuzzle(type), this.onObjectiveDistance, step => sessionStore.resolveStep(step));
      this.scenes.setScene(orla);
      this.session = new GameSession(ORLA_SESSION_CONFIG);
      sessionStore.bind(this.session, () => this.restartPhase(), (id, continuePhase) => {
        orla.expirePhaseOrder(id, continuePhase);
        const puzzleOrders: Record<RepairPuzzleType, string> = {
          pole: 'broken-light-pole-1', signal: 'traffic-signal-failure', sensor: 'sensor-failure',
          car: 'minor-collision', 'signal-check': 'signal-check', charger: 'ev-charger-repair',
        };
        if (this.repairPuzzleOpen && puzzleOrders[this.activeRepairType] === id) {
          this.repairPuzzleOpen = false;
          orla.setTutorialMovementEnabled(true);
          orla.setTutorialCollisionProtection(false);
          this.onRepairPuzzleChange?.(false);
        }
      }, () => {
        if (this.status === 'playing') this.togglePause();
      });
      sessionStore.start();
      if (this.mandatoryTutorialActive || cooperativeWaitingTutorial) sessionStore.setPaused(true);
      else {
        orla.startPhase((id, step) => sessionStore.resolveEvent(id, step));
        orla.selectPlayer(2);
      }
      if (cooperativeWaitingTutorial && this.coopPlayerId !== null) {
        orla.selectPlayer(this.coopPlayerId);
        suburbanGameState.setActiveCharacter(this.coopPlayerId);
        this.coopTutorialActive = true;
        orla.setTutorialMovementEnabled(false);
      }
      this.closeView = false;
      this.onPlayerSelected?.(orla.player.id);
      orla.configureCamera(this.camera, this.camera.aspect, this.closeView);
      // A Orla também recebe a aproximação de câmera na entrada. O deslocamento
      // é aplicado depois do enquadramento normal para não ser sobrescrito pelo follow.
      this.orlaIntro?.kill();
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.orlaIntroOffset.value = reducedMotion ? 0 : 11;
      this.orlaIntro = gsap.to(this.orlaIntroOffset, {
        value: 0,
        duration: reducedMotion ? 0 : 1.5,
        ease: 'power2.inOut',
        onComplete: () => { this.orlaIntro = undefined; },
      });
      this.changeStatus('playing');
      return;
    }
    this.changeStatus('playing');

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const height = GAME_CONFIG.cameraHeight * Math.max(1, 0.85 / this.camera.aspect);
    this.intro = gsap.to(this.camera.position, {
      y: height,
      z: height * GAME_CONFIG.cameraTilt,
      duration: reducedMotion ? 0 : 1.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.camera.lookAt(this.cameraTarget);
      },
    });
  }

  startOrlaWithAnalystTutorial(): void {
    if (this.status !== 'ready' || this.disposed) return;
    this.mandatoryTutorialActive = true;
    this.tutorialStage = 0;
    this.start('fase1-orla');
    this.autoSelectPlayer(3);
    this.setAnalystTabletOpen(true);
  }

  startCoopOrlaTutorial(playerId: PlayerId, options: { sharedAnalyst?: boolean } = {}): void {
    if (this.status !== 'ready' || this.disposed) return;
    this.coopPlayerId = playerId;
    this.sharedAnalyst = !!options.sharedAnalyst && playerId !== ANALYST_ID;
    this.mandatoryTutorialActive = false;
    this.start('fase1-orla', true);
  }

  finishCoopTutorial(): void {
    if (this.disposed || this.coopPlayerId === null || (this.status !== 'playing' && this.status !== 'paused') || !this.coopTutorialActive) return;
    const current = this.scenes.current;
    if (!(current instanceof Fase1OrlaScene)) return;
    current.startPhase((id, step) => sessionStore.resolveEvent(id, step));
    current.setTutorialMovementEnabled(true);
    this.coopTutorialActive = false;
    this.coopAccumulatorMs = 0;
    this.previousTime = null;
    sessionStore.setPaused(this.status === 'paused' && this.coopPlayerId === null);
    suburbanGameState.setActiveCharacter(this.coopPlayerId);
  }

  getCoopPose(): { x: number; z: number; yaw: number } | null {
    if (this.coopPlayerId === null) return null;
    const current = this.scenes.current;
    if (!(current instanceof Fase1OrlaScene)) return null;
    const player = current.players[this.coopPlayerId - 1];
    return { x: player.position.x, z: player.position.z, yaw: player.mesh.rotation.y };
  }

  applyCoopPose(role: CoopRole, x: number, z: number, yaw: number): void {
    if (this.disposed || this.coopPlayerId === null) return;
    const id = role === 'infraestrutura' ? 1 : role === 'mobilidade' ? 2 : 3;
    if (id === this.coopPlayerId) return;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.applyRemotePlayerPose(id, x, z, yaw);
  }

  applyCoopAction(role: CoopRole, action: CoopAction): void {
    // Uma pausa local (perda de foco) chega aos outros com atraso; descartar ações já
    // aplicadas no cliente de origem nesse intervalo deixaria a agenda divergente.
    if (this.disposed || this.coopPlayerId === null || (this.status !== 'playing' && this.status !== 'paused')) return;
    const readiness = this.coopActionReadiness(action);
    if (readiness === 'stale') return;
    if (readiness === 'wait') {
      const now = performance.now();
      this.deferredCoopActions.push({ role, action, queuedAt: now, expiresAt: now + DEFERRED_ACTION_MS });
      return;
    }
    this.applyCoopActionNow(role, action);
  }

  /**
   * Cada cliente roda a agenda no próprio relógio, então uma ação da central pode chegar
   * alguns quadros antes de o chamado existir (ou ser resolvido) aqui. Ela espera em vez
   * de ser descartada; repetições de algo que já aconteceu são ignoradas.
   */
  private coopActionReadiness(action: CoopAction): 'ready' | 'wait' | 'stale' {
    if (action.type !== 'analyze' && action.type !== 'dispatch' && action.type !== 'call-tow' && action.type !== 'archive') return 'ready';
    if (action.problemId === undefined) return 'ready';
    const scene = this.scenes.current;
    const agenda = scene instanceof Fase1OrlaScene ? scene.phaseEventStatus(action.problemId) : 'unknown';
    if (agenda === 'past') return 'stale';
    const problem = suburbanGameState.findProblem(action.problemId);
    if (!problem) return agenda === 'unknown' ? 'stale' : 'wait';
    if (action.type === 'archive') return problem.status === 'RESOLVED' ? 'ready' : 'wait';
    if (problem.status === 'RESOLVED') return 'stale';
    return action.type === 'analyze' || problem.analyzed ? 'ready' : 'wait';
  }

  private flushDeferredCoopActions(): void {
    if (!this.deferredCoopActions.length) return;
    const now = performance.now();
    const scene = this.scenes.current;
    const pending = this.deferredCoopActions.splice(0);
    for (const item of pending) {
      let readiness = this.coopActionReadiness(item.action);
      // A parceira arquivou um chamado que aqui ainda não se resolveu: a simulação local
      // divergiu. Depois de uma tolerância, conclui o chamado aqui para as agendas coincidirem.
      if (readiness === 'wait' && item.action.type === 'archive' && now - item.queuedAt >= ARCHIVE_CONVERGENCE_MS
        && scene instanceof Fase1OrlaScene && scene.phaseEventStatus(item.action.problemId) === 'current'
        && scene.resolvePhaseOrderFromPeer(item.action.problemId)) readiness = this.coopActionReadiness(item.action);
      if (readiness === 'wait' && now > item.expiresAt) readiness = 'stale';
      if (readiness === 'ready') this.applyCoopActionNow(item.role, item.action);
      else if (readiness === 'wait') this.deferredCoopActions.push(item);
    }
  }

  private applyCoopActionNow(role: CoopRole, action: CoopAction): void {
    if (this.disposed || this.coopPlayerId === null) return;
    const actorId: PlayerId = ANALYST_ACTIONS.has(action.type) ? ANALYST_ID
      : role === 'infraestrutura' ? 1 : role === 'mobilidade' ? 2 : 3;
    const current = this.scenes.current;
    if (!(current instanceof Fase1OrlaScene)) return;
    this.applyingCoopAction = true;
    suburbanGameState.setActiveCharacter(actorId);
    try {
      if ((action.type === 'interact' || action.type === 'mobility-hotkey') && action.pose) {
        current.applyRemotePlayerPose(actorId, action.pose.x, action.pose.z, action.pose.yaw);
      }
      switch (action.type) {
        case 'interact': this.input.setActionAxis(action.axis); current.interact(); break;
        case 'analyze': current.analyzeProblem(action.problemId); break;
        case 'dispatch':
          // Despacho nomeia o chamado: não depende da seleção local, que pode ter mudado.
          if (action.problemId !== undefined) suburbanGameState.selectProblem(action.problemId);
          current.dispatchTeam(action.team);
          break;
        case 'archive': this.archiveResolvedProblem(action.problemId); break;
        case 'call-tow': current.callTow(action.problemId, true); break;
        case 'mobility-hotkey': this.useMobilityHotkey(action.key); break;
        case 'repair-complete':
          if (role === 'infraestrutura' && this.remoteRepairType !== null) {
            current.completeRepairPuzzle(this.remoteRepairType);
            this.remoteRepairType = null;
            this.checkSessionEnd();
          }
          break;
        case 'problem-select': suburbanGameState.selectProblem(action.problemId); break;
        case 'tablet': current.setRemoteTabletOpen(actorId, action.open); break;
      }
    } finally {
      this.input.setActionAxis(null);
      suburbanGameState.setActiveCharacter(this.coopPlayerId);
      this.applyingCoopAction = false;
    }
  }

  setAnalystTutorialStep(step: number): void {
    if (!this.disposed && this.mandatoryTutorialActive) this.tutorialStage = step;
  }

  startMobilityTutorial(): void {
    if (this.disposed || !this.mandatoryTutorialActive) return;
    this.tutorialStage = 10;
    this.autoSelectPlayer(2);
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) {
      // Treino sem travar o personagem: as instruções ficam num cartão compacto e o
      // jogador anda à vontade; a proteção contra atropelamento segue ligada.
      current.setTutorialCollisionProtection(true);
      current.setTutorialMovementEnabled(true);
    }
  }

  setMobilityTutorialStep(step: number): void {
    if (this.disposed || !this.mandatoryTutorialActive) return;
    this.tutorialStage = 10 + step;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.setTutorialMovementEnabled(true);
  }

  startInfrastructureTutorial(): void {
    if (this.disposed || !this.mandatoryTutorialActive) return;
    this.tutorialStage = 30;
    this.autoSelectPlayer(1);
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) {
      current.setTutorialCollisionProtection(true);
      current.setTutorialMovementEnabled(true);
      current.setTutorialWorkZonePrepared(true);
    }
  }

  setInfrastructureTutorialStep(step: number): void {
    if (this.disposed || !this.mandatoryTutorialActive) return;
    this.tutorialStage = 30 + step;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.setTutorialMovementEnabled(true);
  }

  getInfrastructureTutorialStep(): number | null {
    return this.mandatoryTutorialActive && this.tutorialStage >= 30 && this.tutorialStage <= 34
      ? this.tutorialStage - 30
      : null;
  }

  getInfrastructureTutorialSnapshot() {
    const current = this.scenes.current;
    return current instanceof Fase1OrlaScene ? current.getInfrastructureTutorialSnapshot() : null;
  }

  /** Pula o treino de qualquer etapa: libera a partida como se o tutorial tivesse terminado. */
  skipTutorial(): boolean {
    if (this.disposed || !this.mandatoryTutorialActive) return false;
    this.repairPuzzleOpen = false;
    this.onRepairPuzzleChange?.(false);
    this.finishTeamTutorials();
    return true;
  }

  finishTeamTutorials(): void {
    if (this.disposed || !this.mandatoryTutorialActive) return;
    this.mandatoryTutorialActive = false;
    this.tutorialStage = 0;
    this.setAnalystTabletOpen(false);
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) {
      current.setTutorialWorkZonePrepared(false);
      current.setTutorialCollisionProtection(false);
      current.setTutorialMovementEnabled(true);
      current.startPhase((id, step) => sessionStore.resolveEvent(id, step));
    }
    sessionStore.setPaused(this.status === 'paused' && this.coopPlayerId === null);
  }

  getMobilityTutorialSnapshot() {
    const current = this.scenes.current;
    return current instanceof Fase1OrlaScene ? current.getMobilityTutorialSnapshot() : null;
  }

  getMobilityTutorialStep(): number | null {
    return this.mandatoryTutorialActive && this.tutorialStage >= 10 && this.tutorialStage < 30
      ? this.tutorialStage - 10
      : null;
  }

  returnToMenu() {
    if (this.disposed || this.status === 'ready') return;
    this.setAnalystTabletOpen(false);
    this.repairPuzzleOpen = false;
    this.mandatoryTutorialActive = false;
    this.tutorialStage = 0;
    this.onRepairPuzzleChange?.(false);
    this.intro?.kill();
    this.intro = undefined;
    this.orlaIntro?.kill();
    this.orlaIntro = undefined;
    this.orlaIntroOffset.value = 0;
    this.closeView = false;
    if (this.session) sessionStore.unbind(this.session);
    this.session = undefined;
    this.observedCallIds.clear();
    this.promptedArchiveIds.clear();
    this.deferredCoopActions.length = 0;
    this.pendingAnalystSelection = false;
    this.input.clear();
    suburbanGameState.setActiveCharacter(1);
    const laboratory = new TestScene(this.onAbilities, this.input);
    this.scenes.setScene(laboratory);
    this.onAbilities?.(laboratory.abilities.snapshot());
    this.camera.fov = GAME_CONFIG.cameraFov;
    this.camera.near = GAME_CONFIG.cameraNear;
    this.camera.far = GAME_CONFIG.cameraFar;
    this.camera.up.set(0, 1, 0);
    this.camera.updateProjectionMatrix();
    this.cameraTarget.set(0, 0, 0);
    const height = GAME_CONFIG.cameraHeight + 4;
    this.camera.position.set(0, height, height * GAME_CONFIG.cameraTilt);
    this.camera.lookAt(this.cameraTarget);
    this.changeStatus('ready');
  }

  togglePause() {
    if (this.disposed || this.status === 'ready' || this.status === 'finished') return;

    this.changeStatus(
      this.status === 'playing' ? 'paused' : 'playing',
    );
  }

  toggleAnalystTablet(): void {
    const current = this.scenes.current;
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen
      || this.mandatoryTutorialActive || this.coopTutorialActive
      || !(current instanceof Fase1OrlaScene) || !this.canHoldAnalystTablet(current)) return;
    this.setAnalystTabletOpen(!this.analystTabletOpen);
  }

  private setAnalystTabletOpen(open: boolean): void {
    // Teclas seguradas enquanto o tablet estava aberto não viram movimento ao guardá-lo.
    const changed = open !== this.analystTabletOpen;
    if (changed) this.input.clear();
    this.analystTabletOpen = open;
    // Só a aparência viaja: cada pessoa continua abrindo e guardando o próprio tablet.
    if (changed && this.coopPlayerId !== null && (this.coopPlayerId === ANALYST_ID || this.sharedAnalyst)) {
      this.onCoopAction?.({ type: 'tablet', open });
    }
    const current = this.scenes.current;
    // O tablet é estado só deste cliente: em dupla cada pessoa abre o seu sem afetar a outra.
    if (current instanceof Fase1OrlaScene) current.setAnalystTabletOpen(open, this.sharedAnalyst && this.coopPlayerId !== null ? this.coopPlayerId : ANALYST_ID);
    this.onAnalystTabletChange?.(open);
  }

  /** A Analista segura o tablet; em dupla, qualquer uma das duas equipes de campo também. */
  private canHoldAnalystTablet(scene: Fase1OrlaScene): boolean {
    return scene.player.id === ANALYST_ID || this.sharedAnalyst;
  }

  /**
   * Ações locais da central exigem o tablet aberto. Ações remotas sempre passam: já foram
   * aplicadas no cliente de origem, mesmo que aqui exista pausa ou puzzle aberto.
   */
  private canUseAnalystTablet(): boolean {
    const current = this.scenes.current;
    if (this.disposed || !(current instanceof Fase1OrlaScene)) return false;
    if (this.applyingCoopAction) return true;
    return this.status === 'playing' && !this.repairPuzzleOpen && this.analystTabletOpen && this.canHoldAnalystTablet(current);
  }

  /** Em dupla, a ação do tablet é executada pela central sem trocar a personagem que a pessoa controla. */
  private asAnalyst<T>(run: () => T): T {
    const previous = suburbanGameState.activeCharacter;
    if (!this.sharedAnalyst || previous === ANALYST_ID) return run();
    suburbanGameState.setActiveCharacter(ANALYST_ID);
    try { return run(); } finally { suburbanGameState.setActiveCharacter(previous); }
  }

  /** E/clique com o tablet aberto em dupla: o mesmo atalho da Analista (analisar, depois solicitar reforço). */
  private sharedAnalystInteract(): void {
    const state = suburbanGameState.snapshot();
    const problem = state.problems.find(item => item.id === state.selectedProblemId && item.status !== 'RESOLVED')
      ?? state.problems.find(item => item.status !== 'RESOLVED');
    if (!problem) return;
    if (!problem.analyzed) this.analyzeProblem(problem.id);
    else this.requestReinforcements(problem.id);
  }

  /** Escolha feita pelo jogador: cancela qualquer troca automática pendente. */
  selectPlayer(id: PlayerId) {
    if (this.coopPlayerId !== null && id !== this.coopPlayerId) return;
    if (!this.canSelectPlayer(id) || this.repairPuzzleOpen) return;
    this.pendingAnalystSelection = false;
    this.applyPlayerSelection(id);
  }

  /**
   * Há chamado esperando a Analista (análise, acionamento ou arquivamento) enquanto
   * o tablet está guardado. A interface usa isso para destacar o botão.
   */
  analystNeedsAttention(): boolean {
    const current = this.scenes.current;
    if (this.mandatoryTutorialActive || !(current instanceof Fase1OrlaScene) || this.analystTabletOpen) return false;
    return suburbanGameState.getProblems().some(problem => problem.status === 'RESOLVED' || !problem.analyzed
      || (problem.requiredTeams ?? []).some(team => !problem.dispatchedTeams.includes(team)));
  }

  /** Troca feita pelo próprio jogo (tutorial, fluxo de chamados): não mexe nas pendências. */
  private autoSelectPlayer(id: PlayerId) {
    if (!this.canSelectPlayer(id) || this.repairPuzzleOpen) return;
    this.applyPlayerSelection(id);
  }

  private applyPlayerSelection(id: PlayerId) {
    this.input.clear();
    if (id !== ANALYST_ID && !this.sharedAnalyst) this.setAnalystTabletOpen(false);
    const current = this.scenes.current;
    if (current instanceof TestScene || current instanceof Fase1OrlaScene) {
      current.selectPlayer(id);
      this.onPlayerSelected?.(id);
    }
  }

  canSelectPlayer(id: PlayerId): boolean {
    if (this.coopPlayerId !== null) return id === this.coopPlayerId && !this.disposed && this.status === 'playing';
    if (this.disposed || this.status !== 'playing') return false;
    if (this.mandatoryTutorialActive) return id === (this.tutorialStage >= 30 ? 1 : this.tutorialStage >= 10 ? 2 : 3);
    const current = this.scenes.current;
    if (!(current instanceof Fase1OrlaScene) || id === 3) return true;
    return current.canSelectPlayer(id);
  }

  interact() {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return;
    if (this.coopTutorialActive) return;
    if (this.mandatoryTutorialActive
      && !((this.tutorialStage >= 2 && this.tutorialStage <= 4)
        || this.tutorialStage === 13 || this.tutorialStage === 17
        || this.tutorialStage === 33 || this.tutorialStage === 35)) return;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) {
      if (this.sharedAnalyst && this.analystTabletOpen && current.player.id !== ANALYST_ID) {
        this.sharedAnalystInteract();
        return;
      }
      if (current.player.id === ANALYST_ID && !this.canUseAnalystTablet()) return;
      current.interact();
      if (this.coopPlayerId !== null && !this.applyingCoopAction) {
        const player = current.player;
        this.onCoopAction?.({ type: 'interact', axis: this.input.getAxis(), pose: { x: player.position.x, z: player.position.z, yaw: player.mesh.rotation.y } });
      }
    }
  }

  selectProblem(id: string): void {
    if (!this.canUseAnalystTablet()) return;
    suburbanGameState.selectProblem(id);
    if (this.coopPlayerId !== null && !this.applyingCoopAction) this.onCoopAction?.({ type: 'problem-select', problemId: id });
  }

  analyzeProblem(id: string): boolean {
    const scene = this.scenes.current;
    if (!(scene instanceof Fase1OrlaScene) || !this.canUseAnalystTablet()) return false;
    const analyzed = this.asAnalyst(() => scene.analyzeProblem(id));
    if (analyzed && this.coopPlayerId !== null && !this.applyingCoopAction) this.onCoopAction?.({ type: 'analyze', problemId: id });
    return analyzed;
  }

  callTow(id: string): boolean {
    const scene = this.scenes.current;
    if (!(scene instanceof Fase1OrlaScene) || !this.canUseAnalystTablet()) return false;
    if (!this.asAnalyst(() => scene.callTow(id))) return false;
    if (this.coopPlayerId !== null && !this.applyingCoopAction) this.onCoopAction?.({ type: 'call-tow', problemId: id });
    return true;
  }

  requestReinforcements(id: string): boolean {
    const scene = this.scenes.current;
    if (!(scene instanceof Fase1OrlaScene) || !this.canUseAnalystTablet()) return false;
    const before = suburbanGameState.snapshot().problems.find(item => item.id === id)?.dispatchedTeams ?? [];
    const dispatched = this.asAnalyst(() => scene.requestReinforcements(id));
    if (!dispatched) return false;
    if (this.coopPlayerId !== null && !this.applyingCoopAction) {
      const problem = suburbanGameState.snapshot().problems.find(item => item.id === id);
      for (const team of problem?.dispatchedTeams ?? []) {
        if (!before.includes(team)) this.onCoopAction?.({ type: 'dispatch', team, problemId: id });
      }
    }
    const problem = suburbanGameState.snapshot().problems.find(item => item.id === id);
    const assigned = problem?.requiredTeams?.find(team => problem.dispatchedTeams.includes(team));
    // No coop cada pessoa fica com a própria personagem; a troca automática é só do modo local.
    if (assigned && this.coopPlayerId === null) this.autoSelectPlayer(assigned === 'infraestrutura' ? 1 : 2);
    return true;
  }

  archiveResolvedProblem(id: string): boolean {
    const scene = this.scenes.current;
    if (!(scene instanceof Fase1OrlaScene) || !this.canUseAnalystTablet()) return false;
    if (!this.asAnalyst(() => scene.archiveResolvedProblem(id))) return false;
    sessionStore.archiveCompleted(id);
    if (this.coopPlayerId !== null && !this.applyingCoopAction) this.onCoopAction?.({ type: 'archive', problemId: id });
    if (this.coopPlayerId === null && !suburbanGameState.snapshot().problems.some(problem => problem.status !== 'RESOLVED')) this.autoSelectPlayer(2);
    this.checkSessionEnd();
    return true;
  }

  useMobilityHotkey(key: string): boolean {
    if (this.coopTutorialActive || this.disposed) return false;
    // Remotas não dependem do estado local (pausa, puzzle ou tablet de quem recebe).
    if (!this.applyingCoopAction && (this.status !== 'playing' || this.repairPuzzleOpen
      || (this.sharedAnalyst && this.analystTabletOpen))) return false;
    const scene = this.scenes.current;
    const mobilityStep = this.tutorialStage - 10;
    const tutorialKeys: Record<number, string> = { 9: 'Digit1', 11: 'Digit2', 13: 'Digit3', 15: 'Digit4', 17: 'Digit1' };
    if (this.mandatoryTutorialActive && tutorialKeys[mobilityStep] !== key) return false;
    const used = (scene instanceof Fase1OrlaScene) && scene.useMobilityHotkey(key);
    if (used && this.coopPlayerId !== null && !this.applyingCoopAction && scene instanceof Fase1OrlaScene) {
      const player = scene.player;
      this.onCoopAction?.({ type: 'mobility-hotkey', key, pose: { x: player.position.x, z: player.position.z, yaw: player.mesh.rotation.y } });
    }
    if (used && this.mandatoryTutorialActive && tutorialKeys[mobilityStep] === key) {
      this.tutorialStage += 1;
    }
    return used;
  }

  private restartPhase(): void {
    if (this.disposed || this.status !== 'finished') return;
    this.returnToMenu();
    this.start('fase1-orla');
  }

  toggleTraffic(): boolean | undefined {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return;
    const current = this.scenes.current;
    return current instanceof Fase1OrlaScene ? current.toggleTraffic() : undefined;
  }

  setCloseView(enabled: boolean) {
    if (this.disposed || this.repairPuzzleOpen) return;
    this.closeView = enabled;
    this.intro?.kill();
    this.intro = undefined;
  }

  useAbility() {
    const world = this.world;
    if (this.disposed || this.status !== 'playing' || !world) return;
    const player = world.player.mesh;
    this.input.clear();
    world.abilities.activate({ x: player.position.x + Math.sin(player.rotation.y) * 1.2, z: player.position.z + Math.cos(player.rotation.y) * 1.2 });
  }

  setAbilityTool(tool: InfraTool) { if (!this.disposed && this.status === 'playing') this.world?.abilities.setTool(tool); }
  selectStop(index: number) { if (!this.disposed && this.status === 'playing') this.world?.abilities.selectStop(index); }
  clickAbilityMap(point: MapPoint, mark: boolean) { if (!this.disposed && this.status === 'playing') this.world?.abilities.mapClick(point, mark); }
  inspectIssue(id: number, mark = false) { if (!this.disposed && this.status === 'playing') this.world?.abilities.inspect(id, mark); }
  resetAbilities() { if (!this.disposed && this.status === 'playing') this.world?.abilities.reset(); }

  private updateCamera(delta: number) {
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) {
      current.updateCamera(this.camera, delta, this.closeView);
      if (this.orlaIntroOffset.value > 0) {
        this.camera.position.y += this.orlaIntroOffset.value;
        this.camera.position.z += this.orlaIntroOffset.value * 0.72;
      }
      return;
    }
    if (this.intro?.isActive()) return;
    const player = this.world?.player.mesh.position;
    if (!player) return;
    const height = this.closeView ? GAME_CONFIG.cameraCloseHeight : GAME_CONFIG.cameraHeight;
    // Altura e recuo variam juntos para preservar a inclinação no zoom.
    const portrait = Math.max(1, 0.85 / this.camera.aspect);
    this.desiredTarget.set(player.x, 0, player.z);
    this.desiredPosition.set(player.x, height * portrait, player.z + height * portrait * GAME_CONFIG.cameraTilt);
    const blend = 1 - Math.exp(-4 * delta);
    this.camera.position.lerp(this.desiredPosition, blend);
    this.cameraTarget.lerp(this.desiredTarget, blend);
    this.camera.lookAt(this.cameraTarget);
  }

  private changeStatus(status: GameStatus) {
    this.idleRendered = false;
    this.status = status;
    this.input.clear();
    if (this.coopPlayerId === null) this.previousTime = null;
    const scene = this.scenes.current;
    if (scene instanceof Fase1OrlaScene) scene.stopMovement();
    if (this.session) sessionStore.setPaused((status === 'paused' && this.coopPlayerId === null) || this.mandatoryTutorialActive || this.coopTutorialActive);

    if (status === 'paused') {
      this.intro?.pause();
      this.orlaIntro?.pause();
    } else {
      this.intro?.resume();
      this.orlaIntro?.resume();
    }

    this.onStatus(status);
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.onBlur();
    }
  };

  private onBlur = () => {
    this.input.clear();
    if (this.coopPlayerId !== null) {
      const scene = this.scenes.current;
      if (scene instanceof Fase1OrlaScene) scene.stopMovement();
      return;
    }
    if (this.status === 'playing') {
      this.changeStatus('paused');
    }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      const feedback = sessionStore.getSnapshot().feedback?.event;
      if (feedback?.type === 'order-expired' || feedback?.type === 'xp-penalty') return;
      this.togglePause();
      return;
    }
    if (this.status === 'playing' && this.mandatoryTutorialActive && !this.repairPuzzleOpen
      && ['KeyE', 'Enter', 'Space'].includes(event.code)) {
      const tutorialTarget = document.querySelector<HTMLElement>('[data-tutorial-target="true"]');
      const targetButton = tutorialTarget instanceof HTMLButtonElement ? tutorialTarget : null;
      const guideButton = document.querySelector<HTMLButtonElement>(
        '.analyst-guide-card .analyst-guide-button, .mobility-guide-card .analyst-guide-button',
      );
      const button = targetButton ?? guideButton;
      if (button && !button.disabled) {
        event.preventDefault();
        event.stopPropagation();
        button.click();
        return;
      }
    }
    if (this.repairPuzzleOpen) {
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    if (event.target instanceof HTMLElement
      && event.target.closest('input, textarea, select, a, [contenteditable="true"]')
      && event.code !== 'KeyE') return;
    const current = this.scenes.current;
    if (this.status === 'playing' && current instanceof Fase1OrlaScene) {
      if (event.code === 'KeyQ' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        this.toggleAnalystTablet();
        return;
      }
      // Em dupla, com o tablet aberto, 1 e 2 acionam equipes como na Analista; guardado, voltam a ser habilidades.
      const operatingTablet = current.player.role === 'analista' || (this.sharedAnalyst && this.analystTabletOpen);
      if (operatingTablet && event.code === 'Digit1') {
        event.preventDefault();
        if (this.mandatoryTutorialActive && this.tutorialStage !== 3) return;
        this.dispatchTeam('infraestrutura');
        return;
      }
      if (operatingTablet && event.code === 'Digit2') {
        event.preventDefault();
        if (this.mandatoryTutorialActive && this.tutorialStage !== 4) return;
        this.dispatchTeam('mobilidade');
        return;
      }
      if (current.player.role === 'mobilidade' && this.mandatoryTutorialActive && event.code.startsWith('Digit')) {
        event.preventDefault();
        this.useMobilityHotkey(event.code);
        return;
      }
      if (current.player.role === 'mobilidade' && this.useMobilityHotkey(event.code)) {
        event.preventDefault();
        return;
      }
      if (event.code === 'KeyE') {
        event.preventDefault();
        this.interact();
      } else if (event.code === 'KeyT' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        this.selectPlayer(this.nextPlayerId(current.player.id));
      }
      return;
    }
    const world = this.world;
    if (this.status === 'playing' && world && event.code === 'KeyT' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      this.selectPlayer(this.nextPlayerId(world.player.id));
      return;
    }
    if (this.status === 'playing' && world && ((world.player.id === 1 && event.code === 'KeyE') || (world.player.id === 2 && event.code === 'Enter'))) {
      event.preventDefault();
      this.useAbility();
    }
  };

  private onCanvasClick = (event: MouseEvent) => {
    if (event.button !== 0 || this.status !== 'playing' || this.repairPuzzleOpen || this.mandatoryTutorialActive) return;
    this.interact();
  };

  private nextPlayerId(current: PlayerId): PlayerId {
    const cycle: readonly PlayerId[] = [3, 1, 2]; // Analista → Infraestrutura → Mobilidade
    const start = cycle.indexOf(current);
    for (let offset = 1; offset <= cycle.length; offset++) {
      const candidate = cycle[(start + offset) % cycle.length];
      if (this.canSelectPlayer(candidate)) return candidate;
    }
    return current;
  }

  private tick = (time: number) => {
    if (this.disposed) return;

    const elapsedMs = this.previousTime === null ? 0 : Math.max(0, time - this.previousTime);
    const delta = Math.min(elapsedMs / 1000, GAME_CONFIG.maxDelta);

    this.previousTime = time;

    if (document.hidden && this.coopPlayerId === null) return;

    if (this.simulating) {
      if (this.status === 'paused' || document.hidden) this.input.clear();
      const advance = (worldDelta: number, clockDelta: number) => {
        if (this.session && !this.mandatoryTutorialActive) {
          sessionStore.tick(clockDelta);
          const scene = this.scenes.current;
          if (scene instanceof Fase1OrlaScene) scene.advancePhase(this.session.snapshot().elapsedMs);
          this.flushDeferredCoopActions();
          this.checkSessionEnd();
        }
        if (this.simulating) this.scenes.update(worldDelta);
      };
      if (this.coopPlayerId !== null && !this.coopTutorialActive) {
        this.coopAccumulatorMs += elapsedMs;
        const stepMs = 1000 / 60;
        // Bounded catch-up. Keep the remainder rather than dropping world time.
        for (let steps = 0; steps < 120 && this.coopAccumulatorMs + 1e-7 >= stepMs && this.simulating; steps++) {
          this.coopAccumulatorMs = Math.max(0, this.coopAccumulatorMs - stepMs);
          advance(stepMs / 1000, stepMs);
        }
      } else advance(delta, elapsedMs);
      this.updateCamera(delta);
    }

    const currentScene = this.scenes.current;
    if (this.status === 'playing' && currentScene instanceof Fase1OrlaScene && !this.mandatoryTutorialActive) {
      const problems = suburbanGameState.getProblems();
      const incoming = problems.find(problem => problem.status !== 'RESOLVED' && !this.observedCallIds.has(problem.id));
      problems.forEach(problem => this.observedCallIds.add(problem.id));
      if (incoming) {
        this.pendingAnalystSelection = true;
      }
      if (this.pendingAnalystSelection && !currentScene.phaseIsCinematic()) {
        this.pendingAnalystSelection = false;
        if (currentScene.player.id !== 3) this.autoSelectPlayer(3);
      }
    }
    // Chamado resolvido leva à Analista uma única vez para arquivar; se o jogador sair,
    // o lembrete fica no botão da Analista em vez de tomar o controle a cada quadro.
    if (this.status === 'playing' && currentScene instanceof Fase1OrlaScene && !currentScene.phaseIsCinematic()) {
      const awaitingArchive = suburbanGameState.getProblems()
        .find(problem => problem.status === 'RESOLVED' && !this.promptedArchiveIds.has(problem.id));
      if (awaitingArchive) {
        this.promptedArchiveIds.add(awaitingArchive.id);
        if (currentScene.player.role !== 'analista') this.autoSelectPlayer(3);
      }
    }

    const current = this.scenes.current;
    if (!document.hidden && current && (this.simulating || !this.idleRendered)) {
      this.renderer.render(current.scene, this.camera);
      this.idleRendered = this.status !== 'playing';
    }
  };

  private openRepairPuzzle(type: RepairPuzzleType = 'pole'): void {
    if (this.disposed) return;
    if (this.applyingCoopAction && this.coopPlayerId !== 1) {
      this.remoteRepairType = type;
      return;
    }
    if (this.status !== 'playing' || this.repairPuzzleOpen) return;
    this.repairPuzzleOpen = true;
    this.activeRepairType = type;
    this.input.clear();
    const scene = this.scenes.current;
    if (scene instanceof Fase1OrlaScene) {
      scene.stopMovement();
      scene.setTutorialMovementEnabled(false);
      scene.setTutorialCollisionProtection(true);
    }
    this.onRepairPuzzleChange?.(true, type);
  }

  completeRepairPuzzle(): void {
    if (this.disposed || this.status !== 'playing' || !this.repairPuzzleOpen) return;
    if (this.coopPlayerId !== null && this.coopPlayerId !== 1) return;
    const current = this.scenes.current;
    if (this.mandatoryTutorialActive && this.tutorialStage === 33) {
      if (current instanceof Fase1OrlaScene) current.resetPoleAfterTutorialRepair();
      this.repairPuzzleOpen = false;
      this.input.clear();
      this.onRepairPuzzleChange?.(false);
      this.setInfrastructureTutorialStep(4);
      return;
    }
    if (current instanceof Fase1OrlaScene) {
      current.completeRepairPuzzle(this.activeRepairType);
      current.setTutorialMovementEnabled(true);
      current.setTutorialCollisionProtection(false);
    }
    if (this.coopPlayerId !== null && !this.applyingCoopAction) this.onCoopAction?.({ type: 'repair-complete' });
    this.repairPuzzleOpen = false;
    this.input.clear();
    this.onRepairPuzzleChange?.(false);
    this.checkSessionEnd();
  }

  private checkSessionEnd(): void {
    if (this.session?.snapshot().status !== 'finished') return;
    this.repairPuzzleOpen = false;
    this.onRepairPuzzleChange?.(false);
    this.changeStatus('finished');
  }

  dispatchTeam(team: ResponseTeam): boolean {
    const current = this.scenes.current;
    if (!(current instanceof Fase1OrlaScene) || !this.canUseAnalystTablet()) return false;
    if (this.mandatoryTutorialActive && !((this.tutorialStage === 3 && team === 'infraestrutura')
      || (this.tutorialStage === 4 && team === 'mobilidade'))) return false;
    const problemId = suburbanGameState.selectedProblemId;
    const dispatched = this.asAnalyst(() => current.dispatchTeam(team));
    if (dispatched && this.coopPlayerId !== null && !this.applyingCoopAction) {
      this.onCoopAction?.(problemId === null ? { type: 'dispatch', team } : { type: 'dispatch', team, problemId });
    }
    return dispatched;
  }

  dispose() {
    if (this.disposed) return;

    this.disposed = true;

    this.renderer.setAnimationLoop(null);
    if (this.backgroundTimer !== null) clearInterval(this.backgroundTimer);
    this.backgroundTimer = null;
    this.deferredCoopActions.length = 0;

    this.intro?.kill();
    this.orlaIntro?.kill();
    this.orlaIntroOffset.value = 0;

    this.resizeObserver.disconnect();

    document.removeEventListener(
      'visibilitychange',
      this.onVisibility,
    );

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onBlur);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);

    if (this.session) sessionStore.unbind(this.session);
    this.session = undefined;
    this.input.dispose();
    this.scenes.dispose();

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}



