import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, Color,
  Group, MathUtils, Mesh, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { GAME_CONFIG, ORLA_MOVEMENT } from '../config';
import { CharacterMotor } from '../core/CharacterMotor';
import { suburbanGameState } from '../core/GameState';
import type { GameState } from '../core/GameState';

export type PlayerId = 1 | 2 | 3;
export type PlayerRole = 'infraestrutura' | 'mobilidade' | 'analista';
export type PlayerAppearance = {
  name: string; role: PlayerRole; skin: string; hair: string; shirt: string; pants: string;
  backpack: string; hairstyle: 'curly' | 'long' | 'blue'; hasCap?: boolean; hideBackpack?: boolean; lowDetail?: boolean;
};
export const PLAYER_APPEARANCES: Record<PlayerId, PlayerAppearance> = {
  1: { name: 'Infraestrutura', role: 'infraestrutura', skin: '#A96F4E', hair: '#241711', shirt: '#174E3C', pants: '#263A59', backpack: '#182A49', hairstyle: 'curly' },
  2: { name: 'Mobilidade', role: 'mobilidade', skin: '#D5A17D', hair: '#211913', shirt: '#6545B5', pants: '#34304E', backpack: '#252A48', hairstyle: 'long', hasCap: true },
  3: { name: 'Analista', role: 'analista', skin: '#E6B38D', hair: '#244DAD', shirt: '#C85C2F', pants: '#293345', backpack: '#202B43', hairstyle: 'blue' },
};
type JointChain = { root: Group; joint: Group; end: Group; side: number };
type HairLock = { root: Group; tip: Group; rest: number; phase: number; angle: number; velocity: number; length: number };
const TAU = Math.PI * 2;
const LEG_LENGTH = 0.4;
const HIP_HEIGHT = 0.82;
const STRIDE = 0.58;
const PLAYER_VISUAL_SCALE = 0.65;

/** Modelo articulado procedural: cada peça pertence à articulação que a move. */
export class Player {
  readonly mesh = new Group();
  /** Referência para o modelo visual usado pela cena Three.js. */
  readonly visualModel = this.mesh;
  readonly id: PlayerId;
  readonly name: string;
  readonly role: PlayerRole;
  readonly gameState: GameState = suburbanGameState;
  /** O estado vem da fonte compartilhada, sem cópia local por personagem. */
  get active() { return this.gameState.activeCharacter === this.id; }
  private readonly body = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly bag = new Group();
  private readonly charm = new Group();
  private readonly tablet = new Group();
  private readonly arms: JointChain[] = [];
  private readonly legs: JointChain[] = [];
  private readonly hairLocks: HairLock[] = [];
  private readonly eyes: Group[] = [];
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly geometries = new Set<BufferGeometry>();
  private readonly sphere: SphereGeometry;
  private elapsed = 0;
  private gait = 0;
  private movement = 0;
  private sprint = 0;
  private readonly motor?: CharacterMotor;
  private disposed = false;
  private seated = false;

  constructor(id: PlayerId = 1, responsiveMovement = false, appearance: PlayerAppearance = PLAYER_APPEARANCES[id]) {
    this.sphere = new SphereGeometry(1, appearance.lowDetail ? 8 : 16, appearance.lowDetail ? 6 : 12);
    if (responsiveMovement) this.motor = new CharacterMotor(ORLA_MOVEMENT);
    this.id = id;
    this.name = PLAYER_APPEARANCES[id].name;
    this.role = PLAYER_APPEARANCES[id].role;
    this.mesh.name = `player-${id}`;
    this.body.name = 'body';
    this.torso.name = 'torso';
    this.head.name = 'head';
    this.bag.name = 'backpack';
    this.charm.name = 'backpack-charm';
    this.mesh.add(this.body);
    this.body.position.y = HIP_HEIGHT;
    this.body.add(this.torso);
    this.torso.position.y = 0.25;
    this.torso.add(this.head, this.bag);
    this.head.position.y = 0.51;
    this.bag.position.set(0, 0.04, -0.24);
    this.build(appearance);
    this.tablet.name = 'analyst-handheld-tablet';
    this.tablet.visible = false;
    if (this.role === 'analista') {
      this.torso.add(this.tablet);
      this.tablet.position.set(0, -0.06, 0.45);
      this.tablet.rotation.x = -0.65;
      this.part(this.tablet, new BoxGeometry(0.54, 0.34, 0.05), '#173746', [0, 0, 0]);
      this.part(this.tablet, new BoxGeometry(0.46, 0.26, 0.012), '#74d9d0', [0, 0, -0.03]);
    }
    this.bag.scale.setScalar(0.78);
    this.mesh.scale.setScalar(PLAYER_VISUAL_SCALE);
    this.animate(0, 0, 0);
  }

  private material(color: string) {
    let material = this.materials.get(color);
    if (!material) {
      material = new MeshStandardMaterial({ color, roughness: 0.78 });
      this.materials.set(color, material);
    }
    return material;
  }

  private part(parent: Group, geometry: BufferGeometry, color: string, position: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
    this.geometries.add(geometry);
    const mesh = new Mesh(geometry, this.material(color));
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    // Peças articuladas se sobrepõem muito; se cada uma recebe sombra das
    // outras, o tronco vira uma mancha escura vista da câmera alta do jogo.
    // Elas continuam projetando sombra no cenário, mas não umas nas outras.
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  }

  private oval(parent: Group, color: string, position: [number, number, number], scale: [number, number, number]) {
    return this.part(parent, this.sphere, color, position, scale);
  }

  private tube(parent: Group, color: string, points: [number, number, number][], radius = 0.012) {
    const curve = new CatmullRomCurve3(points.map(point => new Vector3(...point)));
    return this.part(parent, new TubeGeometry(curve, 12, radius, 5, false), color, [0, 0, 0]);
  }

  private pivot(parent: Group, name: string, position: [number, number, number]) {
    const group = new Group();
    group.name = name;
    group.position.set(...position);
    parent.add(group);
    return group;
  }

  private build(a: PlayerAppearance) {
    if (a.lowDetail) { this.buildSimple(a); return; }
    const trim = `#${new Color(a.shirt).multiplyScalar(0.65).getHexString()}`;
    const highlight = `#${new Color(a.hair).lerp(new Color('#b1a5b1'), a.hairstyle === 'blue' ? 0.11 : 0.06).getHexString()}`;
    const badge = ['#62d7a7', '#cdb1ff', '#8bcaff'][this.id - 1];
    // Moletom, cintura, capuz, bolso e cordões.
    this.part(this.torso, new CapsuleGeometry(0.215, 0.18, 6, 16), a.shirt, [0, 0, 0], [1.12, 1, 0.82]);
    this.oval(this.body, a.pants, [0, 0.015, 0], [0.215, 0.145, 0.155]);
    this.oval(this.torso, trim, [0, -0.23, 0], [0.23, 0.048, 0.17]);
    this.oval(this.torso, trim, [0, 0.22, -0.075], [0.245, 0.12, 0.16]);
    this.oval(this.torso, a.shirt, [0, 0.24, -0.1], [0.212, 0.085, 0.135]);
    this.oval(this.torso, trim, [0, -0.11, 0.164], [0.135, 0.068, 0.02]);
    for (const side of [-1, 1]) {
      this.tube(this.torso, '#dfd8bc', [[side * 0.075, 0.22, 0.14], [side * 0.07, 0.12, 0.18], [side * 0.085, 0.065, 0.19]], 0.008);
      this.oval(this.torso, '#b6b9bb', [side * 0.085, 0.06, 0.19], [0.011, 0.021, 0.011]);
    }
    // Cabeça com orelhas, nariz, olhos, sobrancelhas e sorriso discreto.
    this.part(this.torso, new CapsuleGeometry(0.07, 0.08, 4, 10), a.skin, [0, 0.35, 0]);
    this.oval(this.head, a.skin, [0, 0.12, 0.025], [0.225, 0.265, 0.205]);
    this.oval(this.head, a.skin, [0, 0.065, 0.222], [0.038, 0.044, 0.043]);
    for (const side of [-1, 1]) {
      this.oval(this.head, a.skin, [side * 0.219, 0.085, 0.025], [0.047, 0.069, 0.037]);
      this.oval(this.head, '#b97964', [side * 0.244, 0.085, 0.04], [0.012, 0.035, 0.02]);
      const eye = this.pivot(this.head, `eye-${side}`, [side * 0.085, 0.14, 0.202]);
      this.oval(eye, '#fff6e9', [0, 0, 0], [0.043, 0.052, 0.02]);
      this.oval(eye, this.id === 3 ? '#375768' : '#513a2d', [0, 0, 0.016], [0.026, 0.036, 0.013]);
      this.oval(eye, '#101b29', [0, 0, 0.026], [0.014, 0.024, 0.008]);
      this.oval(eye, '#ffffff', [-0.008, 0.014, 0.033], [0.007, 0.009, 0.004]);
      this.eyes.push(eye);
      this.tube(this.head, a.hair, [[side * 0.045, 0.215, 0.2], [side * 0.083, 0.228, 0.206], [side * 0.12, 0.214, 0.19]], 0.012);
    }
    this.tube(this.head, '#854c45', [[-0.041, -0.015, 0.207], [0, -0.025, 0.218], [0.041, -0.015, 0.207]], 0.007);

    // Mochila arredondada com bolso, alças e pingente articulado.
    if (!a.hideBackpack) {
    this.oval(this.bag, a.backpack, [0, 0, -0.035], [0.225, 0.275, 0.135]);
    this.oval(this.bag, '#34445b', [0, -0.10, -0.15], [0.175, 0.115, 0.045]);
    this.tube(this.bag, '#94a1ac', [[-0.15, -0.03, -0.174], [0, -0.01, -0.195], [0.15, -0.03, -0.174]], 0.005);
    this.tube(this.bag, '#34445b', [[-0.065, 0.23, 0], [-0.065, 0.31, 0], [0.065, 0.31, 0], [0.065, 0.23, 0]], 0.018);
    for (const side of [-1, 1]) {
      this.tube(this.torso, a.backpack, [[side * 0.16, -0.19, 0.13], [side * 0.2, 0.08, 0.155], [side * 0.18, 0.28, 0.01], [side * 0.15, 0.16, -0.26]], 0.026);
    }
    this.part(this.bag, new BoxGeometry(0.065, 0.075, 0.008), badge, [-0.085, 0.11, -0.163]);
    this.bag.add(this.charm);
    this.charm.position.set(0.17, 0.08, -0.14);
    this.tube(this.charm, '#e2ba62', [[0, 0, 0], [0.012, -0.045, -0.01], [0, -0.075, 0]], 0.006);
    this.oval(this.charm, badge, [0, -0.105, 0], [0.026, 0.037, 0.013]);
    }

    for (const side of [-1, 1]) {
      const shoulder = this.pivot(this.torso, `shoulder-${side}`, [side * 0.27, 0.15, 0]);
      this.part(shoulder, new CapsuleGeometry(0.078, 0.15, 4, 12), a.shirt, [0, -0.115, 0]);
      const elbow = this.pivot(shoulder, `elbow-${side}`, [0, -0.25, 0]);
      this.oval(elbow, a.shirt, [0, 0, 0], [0.069, 0.072, 0.069]);
      this.part(elbow, new CapsuleGeometry(0.066, 0.13, 4, 12), a.shirt, [0, -0.10, 0]);
      this.oval(elbow, trim, [0, -0.205, 0], [0.069, 0.032, 0.069]);
      const hand = this.pivot(elbow, `hand-${side}`, [0, -0.25, 0]);
      this.oval(hand, a.skin, [0, -0.015, 0], [0.062, 0.076, 0.046]);
      this.oval(hand, a.skin, [-side * 0.047, 0, 0.025], [0.026, 0.044, 0.025]);
      this.arms.push({ root: shoulder, joint: elbow, end: hand, side });

      const hip = this.pivot(this.body, `hip-${side}`, [side * 0.125, 0, 0]);
      this.part(hip, new CapsuleGeometry(0.09, 0.20, 4, 12), a.pants, [0, -0.17, 0]);
      const knee = this.pivot(hip, `knee-${side}`, [0, -LEG_LENGTH, 0]);
      this.oval(knee, a.pants, [0, 0, 0], [0.08, 0.085, 0.08]);
      this.part(knee, new CapsuleGeometry(0.075, 0.23, 4, 12), a.pants, [0, -0.16, 0]);
      this.oval(knee, '#45516a', [0, -0.30, 0], [0.079, 0.04, 0.079]);
      const foot = this.pivot(knee, `foot-${side}`, [0, -LEG_LENGTH, 0]);
      this.oval(foot, '#f0ede2', [0, -0.035, 0.055], [0.103, 0.065, 0.17]);
      this.oval(foot, '#27354b', [0, -0.006, 0.04], [0.094, 0.059, 0.142]);
      for (const z of [0.055, 0.087, 0.117]) this.tube(foot, '#eae7dd', [[-0.045, 0.041, z], [0, 0.049, z], [0.045, 0.041, z]], 0.006);
      this.legs.push({ root: hip, joint: knee, end: foot, side });
    }

    this.oval(this.head, a.hair, [0, 0.285, -0.022], [0.239, 0.153, 0.22]);
    if (a.hairstyle === 'curly') {
      // Coque e cachos com massas independentes, presos à cabeça.
      for (let i = 0; i < 20; i++) {
        const angle = i * 2.39996;
        const radius = 0.07 + 0.12 * Math.sqrt(i / 20);
        const lock = this.addHair([Math.cos(angle) * radius, 0.31 + (i % 3) * 0.045, -0.10 + Math.sin(angle) * radius], 0.09, 0, i);
        this.oval(lock.root, i % 4 === 0 ? highlight : a.hair, [0, 0.035, 0], [0.08, 0.09, 0.079]);
        this.oval(lock.tip, a.hair, [0, 0.04, 0.01], [0.058, 0.06, 0.055]);
      }
      this.oval(this.head, '#c59a4f', [0, 0.35, -0.13], [0.13, 0.035, 0.13]);
    } else {
      const long = a.hairstyle === 'long';
      for (let i = 0; i < 11; i++) {
        const angle = (i / 10) * Math.PI;
        const length = long ? 0.51 + Math.sin(i * 1.9) * 0.045 : 0.37 + Math.sin(i) * 0.025;
        const lock = this.addHair([Math.cos(angle) * 0.205, 0.23, -Math.sin(angle) * 0.19], length, (i - 5) * 0.025, i);
        const color = i % 3 === 0 ? highlight : a.hair;
        this.oval(lock.root, color, [0, -length * 0.23, -0.012], [0.078, length * 0.36, 0.063]);
        this.oval(lock.tip, color, [0.006, -length * 0.22, 0], [0.062, length * 0.31, 0.052]);
      }
      if (!long) {
        for (let i = 0; i < 4; i++) {
          const fringe = this.oval(this.head, i % 2 ? highlight : a.hair, [-0.14 + i * 0.09, 0.29 - i * 0.018, 0.165], [0.074, 0.13, 0.055]);
          fringe.rotation.z = -0.4;
        }
      }
    }
    if (a.hasCap) {
      // Boné virado para trás, como na arte do menu.
      this.oval(this.head, '#d8c3a1', [0, 0.31, -0.005], [0.25, 0.15, 0.23]);
      this.oval(this.head, '#bda883', [0, 0.29, -0.245], [0.19, 0.022, 0.13]);
      this.oval(this.head, '#bda883', [0, 0.445, -0.005], [0.023, 0.015, 0.023]);
      this.tube(this.head, '#a68f70', [[0, 0.32, 0.22], [0, 0.431, 0.075], [0, 0.431, -0.075], [0, 0.32, -0.225]], 0.004);
    }
  }

  /** Silhueta e articulações completas, sem cordões, cadarços ou cachos individuais. */
  private buildSimple(a: PlayerAppearance) {
    this.oval(this.torso, a.shirt, [0, 0, 0], [.25, .3, .19]);
    this.oval(this.body, a.pants, [0, .015, 0], [.21, .14, .15]);
    this.oval(this.head, a.skin, [0, .12, .025], [.225, .265, .205]);
    this.oval(this.head, a.skin, [0, .065, .222], [.035, .04, .035]);
    for (const side of [-1, 1]) {
      const eye = this.pivot(this.head, `eye-${side}`, [side * .085, .14, .21]);
      this.oval(eye, '#28353c', [0, 0, 0], [.025, .035, .015]);
      this.eyes.push(eye);
      const shoulder = this.pivot(this.torso, `shoulder-${side}`, [side * .27, .15, 0]);
      this.oval(shoulder, a.shirt, [0, -.125, 0], [.078, .16, .078]);
      const elbow = this.pivot(shoulder, `elbow-${side}`, [0, -.25, 0]);
      this.oval(elbow, a.shirt, [0, -.115, 0], [.066, .145, .066]);
      const hand = this.pivot(elbow, `hand-${side}`, [0, -.25, 0]);
      this.oval(hand, a.skin, [0, -.015, 0], [.062, .076, .046]);
      this.arms.push({ root: shoulder, joint: elbow, end: hand, side });
      const hip = this.pivot(this.body, `hip-${side}`, [side * .125, 0, 0]);
      this.oval(hip, a.pants, [0, -.2, 0], [.09, .22, .09]);
      const knee = this.pivot(hip, `knee-${side}`, [0, -LEG_LENGTH, 0]);
      this.oval(knee, a.pants, [0, -.19, 0], [.075, .22, .075]);
      const foot = this.pivot(knee, `foot-${side}`, [0, -LEG_LENGTH, 0]);
      this.oval(foot, '#e4e3d7', [0, -.025, .055], [.1, .065, .17]);
      this.legs.push({ root: hip, joint: knee, end: foot, side });
    }
    this.oval(this.head, a.hair, [0, .3, -.025], [.24, .15, .22]);
    if (a.hairstyle === 'curly') {
      for (const side of [-1, 0, 1]) this.oval(this.head, a.hair, [side * .12, .37, -.13], [.13, .14, .12]);
    } else if (a.hairstyle === 'long') {
      for (const side of [-1, 1]) this.oval(this.head, a.hair, [side * .17, .02, -.12], [.09, .31, .1]);
    } else this.oval(this.head, a.hair, [.09, .27, .15], [.14, .1, .07]);
    if (a.hasCap) {
      this.oval(this.head, '#d8c3a1', [0, .34, -.005], [.25, .14, .23]);
      this.oval(this.head, '#bda883', [0, .29, -.245], [.19, .022, .13]);
    }
    if (!a.hideBackpack) this.oval(this.bag, a.backpack, [0, 0, -.04], [.225, .275, .14]);
    // Só os volumes principais precisam projetar sombras na câmera ampla.
    for (const joint of [...this.arms, ...this.legs]) joint.end.traverse(object => {
      if (object instanceof Mesh) object.castShadow = false;
    });
  }

  private addHair(position: [number, number, number], length: number, rest: number, phase: number) {
    const root = this.pivot(this.head, `hair-${phase}`, position);
    const tip = this.pivot(root, `hair-tip-${phase}`, [0, -length * 0.46, 0]);
    const lock = { root, tip, rest, phase, angle: 0, velocity: 0, length };
    this.hairLocks.push(lock);
    return lock;
  }

  update(delta: number, axis: { x: number; z: number }, resolveMovement?: (
    from: { x: number; z: number }, to: { x: number; z: number },
  ) => { x: number; z: number }, sprinting = false) {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, GAME_CONFIG.maxDelta);
    const x = Number.isFinite(axis.x) ? MathUtils.clamp(axis.x, -1, 1) : 0;
    const z = Number.isFinite(axis.z) ? MathUtils.clamp(axis.z, -1, 1) : 0;
    const length = Math.hypot(x, z);
    const sprint = sprinting && length > 0;
    this.sprint = MathUtils.damp(this.sprint, sprint ? 1 : 0, 10, dt);
    const previousX = this.mesh.position.x;
    const previousZ = this.mesh.position.z;
    let turn = 0;
    if (length > 0 || this.motor) {
      const distance = GAME_CONFIG.playerSpeed * (sprint ? 1.45 : 1) * dt;
      const proposed = { x: previousX + x / (length || 1) * distance, z: previousZ + z / (length || 1) * distance };
      const resolver = resolveMovement ?? ((_from: { x: number; z: number }, to: { x: number; z: number }) => ({
        x: MathUtils.clamp(to.x, -GAME_CONFIG.worldLimit, GAME_CONFIG.worldLimit),
        z: MathUtils.clamp(to.z, -GAME_CONFIG.worldLimit, GAME_CONFIG.worldLimit),
      }));
      const position = this.motor
        ? this.motor.step(dt, { x: previousX, z: previousZ }, { x, z }, sprint, resolver)
        : resolver({ x: previousX, z: previousZ }, proposed);
      this.mesh.position.x = position.x;
      this.mesh.position.z = position.z;
      const target = Math.atan2(x, z);
      const difference = Math.atan2(Math.sin(target - this.mesh.rotation.y), Math.cos(target - this.mesh.rotation.y));
      turn = length > 0 ? difference * (1 - Math.exp(-(this.motor ? ORLA_MOVEMENT.turnSmoothing : 12) * dt)) : 0;
      this.mesh.rotation.y += turn;
      this.mesh.rotation.y = Math.atan2(Math.sin(this.mesh.rotation.y), Math.cos(this.mesh.rotation.y));
    }
    const traveled = Math.hypot(this.mesh.position.x - previousX, this.mesh.position.z - previousZ);
    this.movement = MathUtils.damp(this.movement, traveled > 0.00001 ? 1 : 0, 12, dt);
    this.gait = (this.gait + traveled * Math.PI / STRIDE * (1 + this.sprint * 0.12)) % TAU;
    this.elapsed += dt;
    this.animate(dt, turn / dt, traveled);
  }

  /** Anima um NPC pela distância real percorrida, sem ler input ou mudar a personagem ativa. */
  animateWalking(delta: number, traveled: number, turning = 0): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, GAME_CONFIG.maxDelta);
    this.movement = MathUtils.damp(this.movement, traveled > .00001 ? 1 : 0, 12, dt);
    this.gait = (this.gait + traveled * Math.PI / STRIDE) % TAU;
    this.elapsed += dt;
    this.animate(dt, turning, traveled);
  }

  /** Pose sentada: pés acompanham o pedivela e braços ficam apoiados no guidão. */
  animateCycling(delta: number, traveled: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    this.animateWalking(delta, traveled);
    const phase = this.cyclingPhase;
    this.body.position.y = HIP_HEIGHT;
    this.body.position.x = 0;
    this.torso.rotation.set(.26, 0, Math.sin(phase) * .015 * this.movement);
    this.head.rotation.x = -.18;
    for (const arm of this.arms) {
      arm.root.rotation.set(-1.05, 0, arm.side * -.12);
      arm.joint.rotation.x = -.35;
      arm.end.rotation.set(.2, 0, 0);
    }
    for (const leg of this.legs) {
      const pedalPhase = phase + (leg.side === 1 ? Math.PI : 0);
      const footZ = .08 + Math.cos(pedalPhase) * .17;
      const footY = .23 + Math.sin(pedalPhase) * .17 - HIP_HEIGHT;
      const distance = Math.min(Math.hypot(footY, footZ), LEG_LENGTH * 2 - .001);
      const knee = Math.acos(MathUtils.clamp((distance * distance - 2 * LEG_LENGTH ** 2) / (2 * LEG_LENGTH ** 2), -1, 1));
      leg.root.rotation.x = Math.atan2(-footZ, -footY) - knee / 2;
      leg.joint.rotation.x = knee;
      leg.end.rotation.x = -leg.root.rotation.x - knee;
    }
  }

  get cyclingPhase(): number { return this.gait * .65; }

  /** Alterna a pose sentada para cenas que usam cadeiras. */
  setSeated(seated: boolean): void { this.seated = seated; }

  setTabletOpen(open: boolean): void {
    this.tablet.visible = this.role === 'analista' && open;
  }

  private animate(dt: number, turning: number, traveled: number) {
    const time = this.elapsed + this.id * 1.7;
    const move = this.movement;
    const sprint = this.sprint;
    const breath = Math.sin(time * 2.2);
    if (this.seated) {
      this.body.position.set(0, 0.54 + breath * 0.003, 0);
      this.torso.scale.y = 1 + breath * 0.006;
      this.torso.rotation.set(-0.04, 0, 0);
      this.head.rotation.set(-0.08, Math.sin(time * 0.65) * 0.045, 0);
      for (const arm of this.arms) {
        arm.root.rotation.set(-0.72, 0, arm.side * 0.16);
        arm.joint.rotation.set(-0.62, 0, 0);
        arm.end.rotation.set(0, 0, 0);
      }
      for (const leg of this.legs) {
        leg.root.rotation.set(-1.05, 0, 0);
        leg.joint.rotation.set(1.2, 0, 0);
        leg.end.rotation.set(-0.15, 0, 0);
      }
      this.bag.rotation.set(0, 0, 0);
      this.charm.rotation.z = Math.sin(time * 2.8) * 0.025;
      return;
    }
    this.body.position.y = HIP_HEIGHT + breath * 0.004 + Math.cos(this.gait * 2) * (0.014 + sprint * 0.009) * move;
    this.torso.scale.y = 1 + breath * 0.009;
    this.torso.rotation.x = move * (0.045 + sprint * 0.075);
    this.torso.rotation.z = Math.sin(this.gait) * (0.028 + sprint * 0.018) * move + Math.sin(time * 1.3) * 0.008 * (1 - move);
    this.torso.rotation.y = Math.sin(this.gait) * (0.035 + sprint * 0.025) * move;
    this.body.position.x = Math.sin(this.gait * 2) * 0.012 * sprint * move;
    this.head.rotation.y = Math.sin(time * 0.65) * 0.08 * (1 - move);
    this.head.rotation.x = Math.sin(time * 1.4) * 0.018 - move * 0.025;
    this.head.rotation.z = -this.torso.rotation.z * 0.55;
    // Piscadas breves em momentos diferentes para cada personagem.
    const blinkTime = (time % (4.1 + this.id * 0.37));
    const blink = blinkTime < 0.16 ? 1 - Math.sin(blinkTime / 0.16 * Math.PI) * 0.96 : 1;
    for (const eye of this.eyes) eye.scale.y = blink;
    for (const arm of this.arms) {
      const swing = Math.sin(this.gait + (arm.side === 1 ? Math.PI : 0));
      arm.root.rotation.x = swing * (0.5 + sprint * 0.18) * move + Math.sin(time * 1.6) * 0.025 * (1 - move);
      arm.root.rotation.z = arm.side * (0.09 + 0.025 * Math.sin(time * 2));
      arm.joint.rotation.x = -0.12 - Math.max(0, -swing) * 0.3 * move;
      arm.end.rotation.z = Math.sin(time * 2 + arm.side) * 0.035;
    }
    for (const leg of this.legs) {
      const phase = ((this.gait + (leg.side === 1 ? Math.PI : 0)) % TAU) / TAU;
      const swing = Math.max(0, (phase - 0.5) * 2);
      const footZ = (phase < 0.5 ? STRIDE * (0.5 - phase * 2) : -STRIDE * 0.5 + STRIDE * (0.5 - Math.cos(swing * Math.PI) * 0.5)) * move;
      const lift = Math.sin(swing * Math.PI) * (0.13 + sprint * 0.045) * move;
      const footY = 0.105 + lift - this.body.position.y;
      const distance = Math.min(Math.hypot(footY, footZ), LEG_LENGTH * 2 - 0.001);
      const knee = Math.acos(MathUtils.clamp((distance * distance - 2 * LEG_LENGTH ** 2) / (2 * LEG_LENGTH ** 2), -1, 1));
      leg.root.rotation.x = Math.atan2(-footZ, -footY) - knee / 2;
      leg.joint.rotation.x = knee;
      leg.end.rotation.x = -leg.root.rotation.x - knee;
    }
    if (this.tablet.visible) {
      // A analista pode andar com o tablet; inclina a cabeca e segura o tablet
      // com leve balanco de caminhada nos bracos.
      this.head.rotation.x = 0.22 - move * 0.04;
      for (const arm of this.arms) {
        const tabletSwing = Math.sin(this.gait + (arm.side === 1 ? Math.PI : 0)) * 0.06 * move;
        arm.root.rotation.set(-0.55 + tabletSwing, 0, arm.side * 0.12);
        arm.joint.rotation.set(-1.15, 0, 0);
        arm.end.rotation.set(0, 0, 0);
      }
    }
    this.bag.rotation.x = Math.sin(this.gait * 2 - 0.7) * 0.045 * move;
    this.bag.rotation.z = -this.torso.rotation.z * 0.65;
    this.bag.position.y = 0.04 + Math.sin(this.gait * 2 - 0.7) * 0.012 * move;
    this.charm.rotation.z = Math.sin(time * 2.8 + this.gait) * (0.08 + move * 0.22);
    // Molas amortecidas com subpassos para manter estabilidade em poucos FPS.
    for (const lock of this.hairLocks) {
      const wind = Math.sin(time * 1.7 + lock.phase * 0.6) * 0.035;
      const bounce = Math.sin(this.gait * 2 + lock.phase * 0.5) * 0.07 * move;
      const target = wind + bounce + MathUtils.clamp(-turning * 0.025, -0.16, 0.16) - (traveled > 0 ? 0.035 : 0);
      const steps = Math.max(1, Math.ceil(dt * 120));
      const step = dt / steps;
      for (let i = 0; i < steps; i++) {
        lock.velocity += ((target - lock.angle) * 65 - lock.velocity * 10) * step;
        lock.angle += lock.velocity * step;
      }
      lock.root.rotation.x = lock.angle;
      lock.root.rotation.z = lock.rest + lock.angle * 0.55;
      lock.tip.rotation.x = lock.angle * 0.7 + Math.sin(time * 2 + lock.phase) * 0.018;
      lock.tip.rotation.z = lock.angle * 0.45;
    }
  }

  stopMovement(): void { this.motor?.stop(); }

  setPosition(x: number, z: number) { this.stopMovement(); this.mesh.position.set(x, 0, z); }

  get position() { return this.mesh.position; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.mesh.clear();
  }
}

