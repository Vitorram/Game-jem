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

export type GameSceneId = 'test' | 'fase1-orla';
export type GameStatus = 'ready' | 'playing' | 'paused' | 'finished';

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
  private closeView = false;
  get isCloseView(): boolean { return this.closeView; }
  private readonly cameraTarget = new Vector3(0, 0, 0);
  private readonly desiredPosition = new Vector3();
  private readonly desiredTarget = new Vector3();

  private status: GameStatus = 'ready';
  private repairPuzzleOpen = false;
  private activeRepairType: RepairPuzzleType = 'pole';
  private mandatoryTutorialActive = false;
  private tutorialStage = 0;
  private previousTime: number | null = null;
  private session?: GameSession;
  private disposed = false;
  private idleRendered = false;
  private readonly observedCallIds = new Set<string>();
  private pendingTabletOpen = false;
  /** Chamados resolvidos que já levaram o jogador ao tablet uma vez para arquivar. */
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

  start(sceneId: GameSceneId = 'test') {
    if (this.status !== 'ready' || this.disposed) return;

    if (sceneId === 'fase1-orla') {
      this.observedCallIds.clear();
      this.promptedArchiveIds.clear();
      this.pendingTabletOpen = false;
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
      if (this.mandatoryTutorialActive) sessionStore.setPaused(true);
      else {
        orla.startPhase((id, step) => sessionStore.resolveEvent(id, step));
        orla.selectPlayer(2);
      }
      this.closeView = false;
      this.onPlayerSelected?.(orla.player.id);
      orla.configureCamera(this.camera, this.camera.aspect, this.closeView);
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
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) {
      current.setTutorialWorkZonePrepared(false);
      current.setTutorialCollisionProtection(false);
      current.setTutorialMovementEnabled(true);
      current.startPhase((id, step) => sessionStore.resolveEvent(id, step));
    }
    sessionStore.setPaused(this.status === 'paused');
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
    this.repairPuzzleOpen = false;
    this.mandatoryTutorialActive = false;
    this.tutorialStage = 0;
    this.onRepairPuzzleChange?.(false);
    this.intro?.kill();
    this.intro = undefined;
    this.closeView = false;
    if (this.session) sessionStore.unbind(this.session);
    this.session = undefined;
    this.observedCallIds.clear();
    this.promptedArchiveIds.clear();
    this.pendingTabletOpen = false;
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

  /** Escolha feita pelo jogador: cancela qualquer troca automática pendente. */
  selectPlayer(id: PlayerId) {
    if (!this.canSelectPlayer(id) || this.repairPuzzleOpen) return;
    this.pendingTabletOpen = false;
    this.applyPlayerSelection(id);
  }

  /**
   * Há chamado esperando a Analista (análise, acionamento ou arquivamento) enquanto
   * o jogador controla outra equipe. A interface usa isso para destacar o botão.
   */
  analystNeedsAttention(): boolean {
    const current = this.scenes.current;
    if (this.mandatoryTutorialActive || !(current instanceof Fase1OrlaScene) || current.player.role === 'analista') return false;
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
    const current = this.scenes.current;
    if (current instanceof TestScene || current instanceof Fase1OrlaScene) {
      current.selectPlayer(id);
      this.onPlayerSelected?.(id);
    }
  }

  canSelectPlayer(id: PlayerId): boolean {
    if (this.disposed || this.status !== 'playing') return false;
    if (this.mandatoryTutorialActive) return id === (this.tutorialStage >= 30 ? 1 : this.tutorialStage >= 10 ? 2 : 3);
    const current = this.scenes.current;
    if (!(current instanceof Fase1OrlaScene) || id === 3) return true;
    return current.canSelectPlayer(id);
  }

  interact() {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return;
    if (this.mandatoryTutorialActive
      && !((this.tutorialStage >= 2 && this.tutorialStage <= 4)
        || this.tutorialStage === 13 || this.tutorialStage === 17
        || this.tutorialStage === 33 || this.tutorialStage === 35)) return;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.interact();
  }

  selectProblem(id: string): void {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return;
    const scene = this.scenes.current;
    if (scene instanceof Fase1OrlaScene && scene.player.role !== 'analista') return;
    suburbanGameState.selectProblem(id);
  }

  analyzeProblem(id: string): boolean {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return false;
    const scene = this.scenes.current;
    return scene instanceof Fase1OrlaScene && scene.analyzeProblem(id);
  }

  requestReinforcements(id: string): boolean {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return false;
    const scene = this.scenes.current;
    if (!(scene instanceof Fase1OrlaScene)) return false;
    const dispatched = scene.requestReinforcements(id);
    if (!dispatched) return false;
    const problem = suburbanGameState.snapshot().problems.find(item => item.id === id);
    const assigned = problem?.requiredTeams?.find(team => problem.dispatchedTeams.includes(team));
    if (assigned) this.autoSelectPlayer(assigned === 'infraestrutura' ? 1 : 2);
    return true;
  }

  archiveResolvedProblem(id: string): boolean {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return false;
    const scene = this.scenes.current;
    if (!(scene instanceof Fase1OrlaScene) || !scene.archiveResolvedProblem(id)) return false;
    sessionStore.archiveCompleted(id);
    if (!suburbanGameState.snapshot().problems.some(problem => problem.status !== 'RESOLVED')) this.autoSelectPlayer(2);
    this.checkSessionEnd();
    return true;
  }

  useMobilityHotkey(key: string): boolean {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return false;
    const scene = this.scenes.current;
    const mobilityStep = this.tutorialStage - 10;
    const tutorialKeys: Record<number, string> = { 9: 'Digit1', 11: 'Digit2', 13: 'Digit3', 15: 'Digit4', 17: 'Digit1' };
    if (this.mandatoryTutorialActive && tutorialKeys[mobilityStep] !== key) return false;
    const used = (scene instanceof Fase1OrlaScene) && scene.useMobilityHotkey(key);
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
    this.previousTime = null;
    const scene = this.scenes.current;
    if (scene instanceof Fase1OrlaScene) scene.stopMovement();
    if (this.session) sessionStore.setPaused(status === 'paused' || this.mandatoryTutorialActive);

    if (status === 'paused') {
      this.intro?.pause();
    } else {
      this.intro?.resume();
    }

    this.onStatus(status);
  }

  private onVisibility = () => {
    if (document.hidden) {
      this.onBlur();
    }
  };

  private onBlur = () => {
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
      if (current.player.role === 'analista' && event.code === 'Digit1') {
        event.preventDefault();
        if (this.mandatoryTutorialActive && this.tutorialStage !== 3) return;
        current.dispatchTeam('infraestrutura');
        return;
      }
      if (current.player.role === 'analista' && event.code === 'Digit2') {
        event.preventDefault();
        if (this.mandatoryTutorialActive && this.tutorialStage !== 4) return;
        current.dispatchTeam('mobilidade');
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

    if (document.hidden) return;

    if (this.status === 'playing' && this.session && !this.mandatoryTutorialActive) {
      sessionStore.tick(elapsedMs);
      const scene = this.scenes.current;
      if (scene instanceof Fase1OrlaScene) scene.advancePhase(this.session.snapshot().elapsedMs);
      this.checkSessionEnd();
    }
    if (this.status === 'playing') {
      this.scenes.update(delta);
      this.updateCamera(delta);
    }

    const currentScene = this.scenes.current;
    if (this.status === 'playing' && currentScene instanceof Fase1OrlaScene && !this.mandatoryTutorialActive) {
      const problems = suburbanGameState.getProblems();
      const incoming = problems.find(problem => problem.status !== 'RESOLVED' && !this.observedCallIds.has(problem.id));
      problems.forEach(problem => this.observedCallIds.add(problem.id));
      if (incoming) {
        this.pendingTabletOpen = true;
        if (currentScene.phaseIsCinematic() && currentScene.player.id === 3) this.autoSelectPlayer(2);
      }
      if (this.pendingTabletOpen && !currentScene.phaseIsCinematic()) {
        this.pendingTabletOpen = false;
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
    if (current && (this.status === 'playing' || !this.idleRendered)) {
      this.renderer.render(current.scene, this.camera);
      this.idleRendered = this.status !== 'playing';
    }
  };

  private openRepairPuzzle(type: RepairPuzzleType = 'pole'): void {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return;
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
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return false;
    if (this.mandatoryTutorialActive && !((this.tutorialStage === 3 && team === 'infraestrutura')
      || (this.tutorialStage === 4 && team === 'mobilidade'))) return false;
    const current = this.scenes.current;
    return current instanceof Fase1OrlaScene ? current.dispatchTeam(team) : false;
  }

  dispose() {
    if (this.disposed) return;

    this.disposed = true;

    this.renderer.setAnimationLoop(null);

    this.intro?.kill();

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


