import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
} from 'three';
import type { GridMap } from '../map/GridMap';
import type { TrafficSystem } from './TrafficSystem';

/** Cores das lâmpadas, de cima para baixo na caixa: vermelho, amarelo, verde. */
const BULB_COLORS = ['#e74d42', '#f0c747', '#57cf7c'] as const;

const BULB_ON = 1.35;
const BULB_OFF = 0.08;

/**
 * Semáforos veiculares das esquinas da via principal. Apenas lê o estado do
 * TrafficSystem: a fase do semáforo de pedestres é a mestra e todos os postes
 * exibem o mesmo aspecto, então as três lâmpadas compartilham um material cada.
 */
export class TrafficSignals {
  readonly group = new Group();

  private readonly poleGeometry = new CylinderGeometry(0.055, 0.075, 2.35, 8);
  private readonly baseGeometry = new CylinderGeometry(0.16, 0.19, 0.12, 10);
  private readonly armGeometry = new CylinderGeometry(0.045, 0.045, 1.1, 8);
  private readonly housingGeometry = new BoxGeometry(0.4, 0.98, 0.26);
  private readonly bulbGeometry = new SphereGeometry(0.105, 12, 10);

  private readonly metal = new MeshStandardMaterial({ color: '#27323a', roughness: 0.82 });
  private readonly concrete = new MeshStandardMaterial({ color: '#8d9299', roughness: 0.92 });

  /**
   * Um material por cor, reutilizado em todos os postes: como a fase é única
   * para a via inteira, não existe caixa que precise acender sozinha.
   */
  private readonly bulbMaterials = BULB_COLORS.map(color => new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: BULB_OFF,
    roughness: 0.4,
  }));

  private lastActiveIndex = -1;
  private disposed = false;
  private faulty = false;

  constructor(map: GridMap, private readonly traffic: TrafficSystem) {
    this.group.name = 'traffic-signals';

    const mainRoadZ = map.cellCenter(0, map.rows - 1).z;
    const roadLowEdge = mainRoadZ - map.tileSize * 1.5;

    // Esquinas: antes da travessia (x ≈ 1) no sentido leste e depois dela no oeste.
    const northEdge = roadLowEdge - 0.55;
    const southEdge = roadLowEdge + map.tileSize * 2.35;

    this.addSignal(-1.75, northEdge, 0);
    this.addSignal(3.75, southEdge, Math.PI);
    this.addSignal(-map.width / 2 + 2.2, northEdge, 0);
    this.addSignal(map.width / 2 - 2.2, southEdge, Math.PI);

    this.syncBulbs(this.phaseIndex());
  }

  /** Poste com braço sobre a pista e uma caixa de três lâmpadas na ponta. */
  private addSignal(x: number, z: number, rotationY: number): void {
    const signal = new Group();
    signal.name = 'traffic-signal';
    signal.position.set(x, 0, z);
    signal.rotation.y = rotationY;

    const base = new Mesh(this.baseGeometry, this.concrete);
    base.position.y = 0.06;
    base.castShadow = true;
    base.receiveShadow = true;

    const pole = new Mesh(this.poleGeometry, this.metal);
    pole.position.y = 1.175;
    pole.castShadow = true;
    pole.receiveShadow = true;

    const arm = new Mesh(this.armGeometry, this.metal);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 2.28, 0.55);
    arm.castShadow = true;

    const housing = new Mesh(this.housingGeometry, this.metal);
    housing.position.set(0, 1.86, 1.05);
    housing.castShadow = true;
    housing.receiveShadow = true;

    signal.add(base, pole, arm, housing);

    this.bulbMaterials.forEach((material, index) => {
      const bulb = new Mesh(this.bulbGeometry, material);
      bulb.name = `signal-bulb-${index}`;
      bulb.position.set(0, 2.16 - index * 0.3, 1.19);
      signal.add(bulb);
    });

    this.group.add(signal);
  }

  /**
   * O semáforo de pedestres do TrafficSystem é o estado mestre: fase `red` ali
   * significa travessia liberada e, portanto, vermelho para os veículos.
   */
  private phaseIndex(): number {
    const pedestrianPhase = this.traffic.getPedestrianSignalPhase();
    return pedestrianPhase === 'red' ? 0 : pedestrianPhase === 'yellow' ? 1 : 2;
  }

  private syncBulbs(activeIndex: number): void {
    this.lastActiveIndex = activeIndex;
    this.bulbMaterials.forEach((material, index) => {
      material.emissiveIntensity = index === activeIndex ? BULB_ON : BULB_OFF;
    });
  }

  /** Chame uma vez por frame; só escreve nos materiais quando a fase muda. */
  update(): void {
    if (this.disposed) return;

    if (this.faulty) {
      const blink = Math.floor(Date.now() / 360) % 2 === 0;
      this.bulbMaterials.forEach((material, index) => { material.emissiveIntensity = index === 1 && blink ? BULB_ON : BULB_OFF; });
      return;
    }

    const activeIndex = this.phaseIndex();
    if (activeIndex === this.lastActiveIndex) return;

    this.syncBulbs(activeIndex);
  }

  setFaulty(faulty: boolean): void {
    if (this.disposed || this.faulty === faulty) return;
    this.faulty = faulty;
    this.lastActiveIndex = -1;
    if (!faulty) this.syncBulbs(this.phaseIndex());
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.group.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    [this.poleGeometry, this.baseGeometry, this.armGeometry, this.housingGeometry, this.bulbGeometry]
      .forEach(geometry => geometry.dispose());

    this.metal.dispose();
    this.concrete.dispose();
    this.bulbMaterials.forEach(material => material.dispose());

    this.group.clear();
  }
}
