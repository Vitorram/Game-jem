import {
  WebGLRenderer,
  PerspectiveCamera,
  PCFSoftShadowMap,
  Vector3,
} from 'three';

import { gsap } from 'gsap';
import { Input } from './Input';
import { TestScene } from '../scenes/TestScene';
import { Fase1OrlaScene } from '../scenes/Fase1OrlaScene';
import { SceneManager } from './SceneManager';
import { GAME_CONFIG } from '../config';
import type { PlayerId } from '../entities/Player';
import type { AbilitySnapshot, InfraTool, MapPoint } from './AbilityLab';

export type GameSceneId = 'test' | 'fase1-orla';
export type GameStatus = 'ready' | 'playing' | 'paused';

export class Game {
  readonly input: Input;

  private renderer: WebGLRenderer;
  private camera = new PerspectiveCamera(45, 1, 0.1, 100);
  private readonly scenes = new SceneManager();

  private get world(): TestScene | undefined {
    const current = this.scenes.current;
    return current instanceof TestScene ? current : undefined;
  }
  private resizeObserver: ResizeObserver;
  private intro?: gsap.core.Tween;
  private closeView = false;
  private readonly cameraTarget = new Vector3(0, 0, 0);
  private readonly desiredPosition = new Vector3();
  private readonly desiredTarget = new Vector3();

  private status: GameStatus = 'ready';
  private previousTime = 0;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private onStatus: (status: GameStatus) => void,
    private onAbilities?: (state: AbilitySnapshot) => void,
  ) {
    this.renderer = new WebGLRenderer({
      antialias: true,
    });

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

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
    this.camera.updateProjectionMatrix();
  };

  start(sceneId: GameSceneId = 'test') {
    if (this.status !== 'ready' || this.disposed) return;

    if (sceneId === 'fase1-orla') this.scenes.setScene(new Fase1OrlaScene());
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
    this.intro?.kill();
    this.intro = undefined;
    this.closeView = false;
    this.input.clear();
    const laboratory = new TestScene(this.onAbilities, this.input);
    this.scenes.setScene(laboratory);
    this.onAbilities?.(laboratory.abilities.snapshot());
    this.cameraTarget.set(0, 0, 0);
    const height = GAME_CONFIG.cameraHeight + 4;
    this.camera.position.set(0, height, height * GAME_CONFIG.cameraTilt);
    this.camera.lookAt(this.cameraTarget);
    this.changeStatus('ready');
  }

  togglePause() {
    if (this.disposed || this.status === 'ready') return;

    this.changeStatus(
      this.status === 'playing' ? 'paused' : 'playing',
    );
  }

  selectPlayer(id: PlayerId) {
    if (this.disposed) return;
    this.input.clear();
    this.world?.selectPlayer(id);
  }

  setCloseView(enabled: boolean) {
    if (this.disposed || !this.world) return;
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
    this.previousTime = 0;

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
    if (event.code === 'Escape') { this.togglePause(); return; }
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
    const world = this.world;
    if (this.status === 'playing' && world && ((world.player.id === 1 && event.code === 'KeyE') || (world.player.id === 2 && event.code === 'Enter'))) {
      event.preventDefault();
      this.useAbility();
    }
  };

  private tick = (time: number) => {
    if (this.disposed) return;

    const delta = this.previousTime
      ? Math.min(
          (time - this.previousTime) / 1000,
          GAME_CONFIG.maxDelta,
        )
      : 0;

    this.previousTime = time;

    if (document.hidden) return;

    if (this.status === 'playing') {
      this.scenes.update(delta);
      this.updateCamera(delta);
    }

    const current = this.scenes.current;
    if (current) this.renderer.render(current.scene, this.camera);
  };

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

    this.input.dispose();
    this.scenes.dispose();

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

