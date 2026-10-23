import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
} from 'three';
import type { GridMap } from '../map/GridMap';
import type { TrafficSystem } from './TrafficSystem';

/** Cores das lâmpadas, de cima para baixo na caixa: vermelho, amarelo, verde. */
const BULB_COLORS = ['#eb4438', '#f5c438', '#38d16a'] as const;

const BULB_ON = 1.65;
const BULB_OFF = 0.08;

/**
 * Semáforos veiculares padrão CONTRAN/CET e focos de pedestres junto à travessia da avenida.
 * Os pórticos ficam assentados nas calçadas norte e sul, com braço projetado sobre as faixas,
 * anteparo preto com borda refletiva amarela, pestanas sobre as lentes e botoeira acessível.
 */
export class TrafficSignals {
  readonly group = new Group();

  private readonly poleGeometry = new CylinderGeometry(0.042, 0.062, 2.85, 12);
  private readonly baseGeometry = new CylinderGeometry(0.12, 0.15, 0.16, 12);
  private readonly flangeGeometry = new CylinderGeometry(0.085, 0.095, 0.08, 10);
  private readonly armGeometry = new CylinderGeometry(0.032, 0.038, 1.45, 10);
  private readonly braceGeometry = new CylinderGeometry(0.018, 0.02, 0.58, 8);
  private readonly housingGeometry = new BoxGeometry(0.14, 0.78, 0.28);
  private readonly backplateGeometry = new BoxGeometry(0.03, 0.88, 0.38);
  private readonly borderVGeometry = new BoxGeometry(0.034, 0.9, 0.022);
  private readonly borderHGeometry = new BoxGeometry(0.034, 0.022, 0.4);
  private readonly visorGeometry = new CylinderGeometry(0.092, 0.092, 0.13, 12, 1, true, -Math.PI * 0.55, Math.PI * 1.1);
  private readonly pedHousingGeometry = new BoxGeometry(0.16, 0.44, 0.16);
  private readonly buttonBoxGeometry = new BoxGeometry(0.09, 0.18, 0.08);
  private readonly bulbGeometry = new SphereGeometry(0.082, 12, 10);

  private readonly metal = new MeshStandardMaterial({ color: '#263038', roughness: 0.62, metalness: 0.25 });
  private readonly housingDark = new MeshStandardMaterial({ color: '#151a1f', roughness: 0.75 });
  private readonly accent = new MeshStandardMaterial({ color: '#f2c849', roughness: 0.52 });
  private readonly buttonBlue = new MeshStandardMaterial({ color: '#2b6cb0', roughness: 0.58 });
  private readonly concrete = new MeshStandardMaterial({ color: '#8d9299', roughness: 0.9 });

  private readonly bulbMaterials = BULB_COLORS.map(color => new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: BULB_OFF,
    roughness: 0.32,
  }));

  private lastActiveIndex = -1;
  private disposed = false;
  private faulty = false;

  constructor(map: GridMap, private readonly traffic: TrafficSystem) {
    this.group.name = 'traffic-signals';

    const southEdgeZ = map.depth / 2;
    const northCurbZ = southEdgeZ - 6.28; // Z = 5.72 (Calçada Norte, logo antes do meio-fio em Z = 5.94)
    const southCurbZ = southEdgeZ - 0.58; // Z = 11.42 (Calçada Sul, logo após o meio-fio em Z = 11.26)

    // Sentido Leste (carros vêm de -X): pórtico na Calçada Norte, braço sobre pista Leste, foco para -X
    this.addSignal(-0.74, northCurbZ, 1, -1);
    // Sentido Oeste (carros vêm de +X): pórtico na Calçada Sul, braço sobre pista Oeste, foco para +X
    this.addSignal(2.74, southCurbZ, -1, 1);
    // Os postes ficam na calçada: pedestres NPC desviam deles como do resto do mobiliário.
    map.addObstacle(-0.74, northCurbZ, 0.16);
    map.addObstacle(2.74, southCurbZ, 0.16);

    this.syncBulbs(this.phaseIndex());
  }

  /** Pórtico semafórico esguio com braço projetado, grupo focal principal com pestanas e foco de pedestre. */
  private addSignal(x: number, z: number, armDirZ: 1 | -1, faceDirX: 1 | -1): void {
    const signal = new Group();
    signal.name = 'traffic-signal';
    signal.position.set(x, 0, z);

    const base = new Mesh(this.baseGeometry, this.concrete);
    base.position.y = 0.08;
    base.castShadow = true;
    base.receiveShadow = true;

    const flange = new Mesh(this.flangeGeometry, this.metal);
    flange.position.y = 0.18;
    flange.castShadow = true;

    const pole = new Mesh(this.poleGeometry, this.metal);
    pole.position.y = 1.425;
    pole.castShadow = true;
    pole.receiveShadow = true;

    const finial = new Mesh(this.bulbGeometry, this.metal);
    finial.scale.setScalar(0.65);
    finial.position.y = 2.86;

    const arm = new Mesh(this.armGeometry, this.metal);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 2.66, armDirZ * 0.72);
    arm.castShadow = true;

    // Mão-francesa diagonal de reforço entre a coluna e o braço projetado
    const brace = new Mesh(this.braceGeometry, this.metal);
    brace.rotation.x = armDirZ * 0.72;
    brace.position.set(0, 2.45, armDirZ * 0.22);
    brace.castShadow = true;

    signal.add(base, flange, pole, finial, arm, brace);

    // Grupo focal suspenso no braço projetado
    const housingZ = armDirZ * 1.32;
    this.addVehicleSignalHead(signal, 0, 2.38, housingZ, faceDirX, 1);

    // Grupo focal repetidor na coluna para visibilidade próxima na linha de retenção
    this.addVehicleSignalHead(signal, -faceDirX * 0.06, 1.92, armDirZ * 0.08, faceDirX, 0.72);

    // Unidade de pedestres e botoeira sonora acessível voltadas para a faixa zebrada
    this.attachPedestrianUnit(signal, armDirZ);

    this.group.add(signal);
  }

  private addVehicleSignalHead(
    parent: Group,
    x: number,
    y: number,
    z: number,
    faceDirX: 1 | -1,
    scale: number,
  ): void {
    const head = new Group();
    head.position.set(x, y, z);
    head.scale.setScalar(scale);

    const housing = new Mesh(this.housingGeometry, this.housingDark);
    housing.castShadow = true;
    housing.receiveShadow = true;

    const backplate = new Mesh(this.backplateGeometry, this.housingDark);
    backplate.position.x = -faceDirX * 0.04;
    backplate.castShadow = true;

    // Filetes amarelos refletivos contornando o anteparo (padrão CET/CONTRAN)
    for (const sideZ of [-0.19, 0.19]) {
      const borderV = new Mesh(this.borderVGeometry, this.accent);
      borderV.position.set(-faceDirX * 0.04, 0, sideZ);
      head.add(borderV);
    }
    for (const sideY of [-0.44, 0.44]) {
      const borderH = new Mesh(this.borderHGeometry, this.accent);
      borderH.position.set(-faceDirX * 0.04, sideY, 0);
      head.add(borderH);
    }

    head.add(housing, backplate);

    this.bulbMaterials.forEach((material, index) => {
      const bulbY = 0.25 - index * 0.25;

      const bulb = new Mesh(this.bulbGeometry, material);
      bulb.name = `signal-bulb-${index}`;
      bulb.scale.set(0.55, 1, 1);
      bulb.position.set(faceDirX * 0.068, bulbY, 0);
      head.add(bulb);

      // Pestana / viseira superior cobrindo cada lente
      const visor = new Mesh(this.visorGeometry, this.housingDark);
      visor.rotation.z = Math.PI / 2;
      visor.rotation.x = faceDirX === 1 ? 0 : Math.PI;
      visor.position.set(faceDirX * 0.11, bulbY + 0.015, 0);
      head.add(visor);
    });

    parent.add(head);
  }

  private attachPedestrianUnit(parent: Group, faceDirZ: 1 | -1): void {
    const pedBox = new Mesh(this.pedHousingGeometry, this.housingDark);
    pedBox.position.set(0, 1.42, faceDirZ * 0.11);
    pedBox.castShadow = true;

    // Botoeira acessível azul com painel frontal amarelo
    const buttonBox = new Mesh(this.buttonBoxGeometry, this.buttonBlue);
    buttonBox.position.set(0, 0.96, faceDirZ * 0.075);

    const buttonFace = new Mesh(this.buttonBoxGeometry, this.accent);
    buttonFace.scale.set(0.65, 0.55, 0.25);
    buttonFace.position.set(0, 0.96, faceDirZ * 0.11);

    // Semáforo veicular vermelho (0) -> pedestre verde (2); veicular verde (2) -> pedestre vermelho (0)
    const pedStopBulb = new Mesh(this.bulbGeometry, this.bulbMaterials[2]);
    pedStopBulb.scale.set(0.68, 0.68, 0.42);
    pedStopBulb.position.set(0, 1.52, faceDirZ * 0.19);

    const pedWalkBulb = new Mesh(this.bulbGeometry, this.bulbMaterials[0]);
    pedWalkBulb.scale.set(0.68, 0.68, 0.42);
    pedWalkBulb.position.set(0, 1.32, faceDirZ * 0.19);

    parent.add(pedBox, buttonBox, buttonFace, pedStopBulb, pedWalkBulb);
  }

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

    [
      this.poleGeometry,
      this.baseGeometry,
      this.flangeGeometry,
      this.armGeometry,
      this.braceGeometry,
      this.housingGeometry,
      this.backplateGeometry,
      this.borderVGeometry,
      this.borderHGeometry,
      this.visorGeometry,
      this.pedHousingGeometry,
      this.buttonBoxGeometry,
      this.bulbGeometry,
    ].forEach(geometry => geometry.dispose());

    this.metal.dispose();
    this.housingDark.dispose();
    this.accent.dispose();
    this.buttonBlue.dispose();
    this.concrete.dispose();
    this.bulbMaterials.forEach(material => material.dispose());

    this.group.clear();
  }
}
