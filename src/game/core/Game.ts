import { WebGLRenderer, PerspectiveCamera, PCFSoftShadowMap } from 'three';
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

  constructor(private host: HTMLElement, private onStatus: (status: GameStatus) => void) {
    // O construtor é chamado exclusivamente no useEffect do componente cliente.
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Cenário 3D de teste');
    host.appendChild(this.renderer.domElement);
    this.world = new TestScene();
    this.input = new Input();
    this.camera.position.set(0, 18, 18);
    this.camera.lookAt(0, 0, 0);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onBlur);
    this.renderer.setAnimationLoop(this.tick);
  }

  private resize = () => {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GAME_CONFIG.maxPixelRatio));
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  start() {
    if (this.status !== 'ready') return;
    this.changeStatus('playing');
    this.intro = gsap.to(this.camera.position, {
      y: 14, z: 12,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1.5,
      ease: 'power2.inOut',
      onUpdate: () => this.camera.lookAt(0, 0, 0),
    });
  }

  togglePause() {
    if (this.status === 'ready') return;
    this.changeStatus(this.status === 'playing' ? 'paused' : 'playing');
  }

  private changeStatus(status: GameStatus) {
    this.status = status;
    this.input.clear();
    this.previousTime = 0;
    if (status === 'paused') this.intro?.pause();
    else this.intro?.resume();
    this.onStatus(status);
  }

  private onVisibility = () => { if (document.hidden) this.onBlur(); };
  private onBlur = () => { if (this.status === 'playing') this.changeStatus('paused'); };
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape' && !event.repeat) this.togglePause();
  };

  private tick = (time: number) => {
    const delta = this.previousTime ? Math.min((time - this.previousTime) / 1000, GAME_CONFIG.maxDelta) : 0;
    this.previousTime = time;
    if (document.hidden || this.disposed) return;
    if (this.status === 'playing') this.world.update(delta, this.input);
    this.renderer.render(this.world.scene, this.camera);
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.intro?.kill();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onBlur);
    this.input.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
