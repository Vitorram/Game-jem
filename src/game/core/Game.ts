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
  private previousTime: number | null = null;
  private session?: GameSession;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private onStatus: (status: GameStatus) => void,
    private onAbilities?: (state: AbilitySnapshot) => void,
    private onPlayerSelected?: (id: PlayerId) => void,
    private onRisks?: (state: RiskSnapshot) => void,
    private onInteractionPrompt?: (prompt: string | null) => void,
    private onRepairPuzzleChange?: (open: boolean) => void,
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

    this.camera.aspect = width / height;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.configureCamera(this.camera, this.camera.aspect, this.closeView);
    else this.camera.updateProjectionMatrix();
  };

  start(sceneId: GameSceneId = 'test') {
    if (this.status !== 'ready' || this.disposed) return;

    if (sceneId === 'fase1-orla') {
      suburbanGameState.reset();
      const orla = new Fase1OrlaScene(this.input, this.onRisks, this.onInteractionPrompt, () => this.openRepairPuzzle(), this.onObjectiveDistance, step => sessionStore.resolveStep(step));
      this.scenes.setScene(orla);
      this.session = new GameSession(ORLA_SESSION_CONFIG);
      sessionStore.bind(this.session, () => this.restartPhase());
      sessionStore.start();
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

  returnToMenu() {
    if (this.disposed || this.status === 'ready') return;
    this.repairPuzzleOpen = false;
    this.onRepairPuzzleChange?.(false);
    this.intro?.kill();
    this.intro = undefined;
    this.closeView = false;
    if (this.session) sessionStore.unbind(this.session);
    this.session = undefined;
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

  selectPlayer(id: PlayerId) {
    if (this.disposed || this.repairPuzzleOpen || this.status !== 'playing') return;
    this.input.clear();
    const current = this.scenes.current;
    if (current instanceof TestScene || current instanceof Fase1OrlaScene) {
      current.selectPlayer(id);
      this.onPlayerSelected?.(id);
    }
  }

  interact() {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.interact();
  }

  useMobilityHotkey(key: string): boolean {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return false;
    const scene = this.scenes.current;
    return (scene instanceof Fase1OrlaScene) && scene.useMobilityHotkey(key);
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
    this.status = status;
    this.input.clear();
    this.previousTime = null;
    const scene = this.scenes.current;
    if (scene instanceof Fase1OrlaScene) scene.stopMovement();
    if (this.session) sessionStore.setPaused(status === 'paused');

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
    if (event.code === 'Escape') { event.preventDefault(); this.togglePause(); return; }
    if (this.repairPuzzleOpen) {
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    const current = this.scenes.current;
    if (this.status === 'playing' && current instanceof Fase1OrlaScene) {
      if (current.player.role === 'analista' && event.code === 'Digit1') {
        event.preventDefault();
        current.dispatchTeam('infraestrutura');
        return;
      }
      if (current.player.role === 'analista' && event.code === 'Digit2') {
        event.preventDefault();
        current.dispatchTeam('mobilidade');
        return;
      }
      if (current.player.role === 'mobilidade' && current.useMobilityHotkey(event.code)) {
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

  private nextPlayerId(current: PlayerId): PlayerId {
    const cycle: readonly PlayerId[] = [3, 1, 2]; // Analista → Infraestrutura → Mobilidade
    return cycle[(cycle.indexOf(current) + 1) % cycle.length];
  }

  private tick = (time: number) => {
    if (this.disposed) return;

    const elapsedMs = this.previousTime === null ? 0 : Math.max(0, time - this.previousTime);
    const delta = Math.min(elapsedMs / 1000, GAME_CONFIG.maxDelta);

    this.previousTime = time;

    if (document.hidden) return;

    if (this.status === 'playing' && this.session) {
      sessionStore.tick(elapsedMs);
      this.checkSessionEnd();
    }
    if (this.status === 'playing' && !this.repairPuzzleOpen) {
      this.scenes.update(delta);
      this.updateCamera(delta);
    }

    const current = this.scenes.current;
    if (current) this.renderer.render(current.scene, this.camera);
  };

  private openRepairPuzzle(): void {
    if (this.disposed || this.status !== 'playing' || this.repairPuzzleOpen) return;
    this.repairPuzzleOpen = true;
    this.input.clear();
    const scene = this.scenes.current;
    if (scene instanceof Fase1OrlaScene) scene.stopMovement();
    this.onRepairPuzzleChange?.(true);
  }

  completeRepairPuzzle(): void {
    if (this.disposed || this.status !== 'playing' || !this.repairPuzzleOpen) return;
    const current = this.scenes.current;
    if (current instanceof Fase1OrlaScene) current.completePoleRepair();
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

    if (this.session) sessionStore.unbind(this.session);
    this.session = undefined;
    this.input.dispose();
    this.scenes.dispose();

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}


