
import {
  WebGLRenderer,
  PerspectiveCamera,
  PCFSoftShadowMap,
} from 'three';

import { gsap } from 'gsap';
import { Input } from './Input';
import { TestScene } from '../scenes/TestScene';
import { GAME_CONFIG } from '../config';

export type GameStatus = 'ready' | 'playing' | 'paused';

export class Game {
  readonly input: Input;

  private renderer: WebGLRenderer;
  private camera = new PerspectiveCamera(45, 1, 0.1, 100);
  private world: TestScene;
  private resizeObserver: ResizeObserver;
  private intro?: gsap.core.Tween;

  private status: GameStatus = 'ready';
  private previousTime = 0;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private onStatus: (status: GameStatus) => void,
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

    // Cria o cenário. Os três personagens devem ser
    // adicionados e atualizados dentro de TestScene.ts.
    this.world = new TestScene();

    // Gerencia as entradas do teclado.
    this.input = new Input();

    // Posiciona a câmera acima do cenário.
    this.camera.position.set(0, 18, 18);
    this.camera.lookAt(0, 0, 0);

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

  start() {
    if (this.status !== 'ready' || this.disposed) return;

    this.changeStatus('playing');

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    this.intro = gsap.to(this.camera.position, {
      y: 14,
      z: 12,
      duration: reducedMotion ? 0 : 1.5,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.camera.lookAt(0, 0, 0);
      },
    });
  }

  togglePause() {
    if (this.disposed || this.status === 'ready') return;

    this.changeStatus(
      this.status === 'playing' ? 'paused' : 'playing',
    );
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
    if (event.code === 'Escape' && !event.repeat) {
      this.togglePause();
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
      // TestScene deve atualizar os três personagens.
      this.world.update(delta, this.input);
    }

    this.renderer.render(this.world.scene, this.camera);
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
    this.world.dispose();

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
