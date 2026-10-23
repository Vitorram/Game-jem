import {
  BoxGeometry, BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, RingGeometry, SphereGeometry, TorusGeometry,
} from 'three';
import { WORK_ZONE_CLEARANCE } from '../traffic/TrafficSystem';

/** Deslocamento local para posicionar a base física do poste no meio-fio da calçada norte (Row 8). */
const POLE_SIDEWALK_OFFSET_Z = 0.88;

/** Poste de iluminação pública da missão, posicionado no bordo da calçada com caixa de inspeção. */
export class BrokenPoleMarker {
  readonly group = new Group();
  private readonly poleStructure = new Group();
  private readonly headAssembly = new Group();
  private readonly alert = new Group();
  private readonly resolvedBadge = new Group();
  private readonly cones = new Group();
  private readonly geometries: BufferGeometry[] = [
    new TorusGeometry(0.54, 0.04, 6, 28),             // 0: anel marcador de piso na base
    new CylinderGeometry(0.14, 0.19, 0.34, 10),       // 1: pedestal de concreto
    new CylinderGeometry(0.06, 0.095, 3.1, 10),       // 2: fuste principal metálico
    new CylinderGeometry(0.04, 0.052, 1.15, 8),       // 3: braço curvo superior
    new BoxGeometry(0.28, 0.44, 0.2),                 // 4: caixa de inspeção elétrica
    new BoxGeometry(0.36, 0.11, 0.56),                // 5: carcaça da luminária LED
    new ConeGeometry(0.3, 0.42, 3),                   // 6: placa triangular de alerta
    new BoxGeometry(0.05, 0.16, 0.05),                // 7: haste da exclamação
    new SphereGeometry(0.042, 8, 6),                  // 8: ponto da exclamação
    new ConeGeometry(0.2, 0.55, 8),                   // 9: cones de manutenção
    new SphereGeometry(0.16, 12, 10),                 // 10: lente difusora LED
    new TorusGeometry(0.38, 0.042, 6, 20),            // 11: anel de concluído
    new BoxGeometry(0.24, 0.075, 0.09),               // 12: check curto
    new BoxGeometry(0.44, 0.075, 0.09),               // 13: check longo
    new SphereGeometry(0.42, 12, 8),                  // 14: halo luminoso da lâmpada
  ];
  private readonly materials = [
    new MeshStandardMaterial({ color: '#ff9f35', emissive: '#6b2c00', roughness: 0.65 }), // 0: anel alerta
    new MeshStandardMaterial({ color: '#39464e', roughness: 0.72 }),                      // 1: aço galvanizado escuro
    new MeshStandardMaterial({ color: '#ffd45c', emissive: '#593d00', roughness: 0.55 }), // 2: amarelo aviso
    new MeshStandardMaterial({ color: '#252b30', roughness: 0.8 }),                       // 3: detalhe escuro
    new MeshStandardMaterial({ color: '#ff8b32', roughness: 0.72 }),                      // 4: laranja cone
    new MeshStandardMaterial({ color: '#ffe58a', emissive: '#ffd34e', emissiveIntensity: 2.2 }), // 5: LED aceso
    new MeshStandardMaterial({ color: '#62dc9b', emissive: '#1d7046', emissiveIntensity: 1.15, roughness: 0.62 }), // 6: verde resolvido
    new MeshStandardMaterial({ color: '#8d9499', roughness: 0.88 }),                      // 7: base concreto
  ];
  private readonly lamp = new Mesh(this.geometries[10], this.materials[5]);
  private readonly glowMaterial = new MeshBasicMaterial({ color: '#ffe58a', transparent: true, opacity: 0.22, depthWrite: false });
  private readonly lampGlow = new Mesh(this.geometries[14], this.glowMaterial);
  private readonly lampLight = new PointLight('#ffe58a', 2.8, 9, 2);
  private readonly workZoneDiskGeometry = new CircleGeometry(WORK_ZONE_CLEARANCE, 48);
  private readonly workZoneRingGeometry = new RingGeometry(WORK_ZONE_CLEARANCE - 0.09, WORK_ZONE_CLEARANCE, 48);
  private readonly workZoneDiskMaterial = new MeshBasicMaterial({ color: '#f07562', transparent: true, opacity: 0.1, depthWrite: false, toneMapped: false });
  private readonly workZoneRingMaterial = new MeshBasicMaterial({ color: '#ff886c', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  private readonly workZoneDisk = new Mesh(this.workZoneDiskGeometry, this.workZoneDiskMaterial);
  private readonly workZoneRing = new Mesh(this.workZoneRingGeometry, this.workZoneRingMaterial);
  private elapsed = 0;

  constructor(position: { x: number; z: number }) {
    this.group.name = 'broken-light-pole-problem';
    this.group.position.set(position.x, 0, position.z);

    // A estrutura física do poste fica assentada na calçada norte (fora da faixa de ciclistas).
    this.poleStructure.position.set(0, 0, POLE_SIDEWALK_OFFSET_Z);
    this.group.add(this.poleStructure);

    // Anel indicador na base do poste (children[0] preservado para visibilidade de status)
    this.add(this.geometries[0], this.materials[0], [0, 0.035, POLE_SIDEWALK_OFFSET_Z], [1, 1, 1], Math.PI / 2);

    // Pedestal de concreto + coluna metálica + quadro de disjuntor/circuito na altura das mãos
    this.addTo(this.poleStructure, this.geometries[1], this.materials[7], [0, 0.17, 0]);
    this.addTo(this.poleStructure, this.geometries[2], this.materials[1], [0, 1.85, 0]);
    this.addTo(this.poleStructure, this.geometries[4], this.materials[1], [0, 1.05, -0.09]);
    this.addTo(this.poleStructure, this.geometries[4], this.materials[2], [0, 1.05, -0.155], [0.68, 0.55, 0.2]);

    // Conjunto superior (braço + luminária pública voltada para a avenida)
    this.headAssembly.position.set(0, 3.32, 0);
    this.addTo(this.headAssembly, this.geometries[3], this.materials[1], [0, 0.18, 0.48], [1, 1, 1], 1.18);
    this.addTo(this.headAssembly, this.geometries[5], this.materials[3], [0, 0.36, 1.02]);
    this.poleStructure.add(this.headAssembly);

    this.lamp.position.set(0, 0.28, 1.04);
    this.lamp.scale.set(0.9, 0.45, 1.35);
    this.lamp.visible = false;
    this.headAssembly.add(this.lamp);

    this.lampGlow.position.set(0, 3.55, POLE_SIDEWALK_OFFSET_Z + 1.04);
    this.lampGlow.visible = false;
    this.group.add(this.lampGlow);

    this.lampLight.position.copy(this.lampGlow.position);
    this.lampLight.visible = false;
    this.group.add(this.lampLight);

    // Ícone de alerta logo acima da caixa de circuito elétrico
    this.alert.position.set(0, 2.05, POLE_SIDEWALK_OFFSET_Z - 0.18);
    this.addTo(this.alert, this.geometries[6], this.materials[2], [0, 0, 0]);
    this.addTo(this.alert, this.geometries[7], this.materials[3], [0, 0.01, 0]);
    this.addTo(this.alert, this.geometries[8], this.materials[3], [0, -0.11, 0]);
    this.group.add(this.alert);

    this.resolvedBadge.position.set(0, 2.05, POLE_SIDEWALK_OFFSET_Z - 0.18);
    const resolvedRing = new Mesh(this.geometries[11], this.materials[6]);
    resolvedRing.rotation.x = Math.PI / 2;
    this.resolvedBadge.add(resolvedRing);
    const checkShort = new Mesh(this.geometries[12], this.materials[6]);
    checkShort.position.set(-0.07, 0.02, 0.03);
    checkShort.rotation.y = -0.68;
    const checkLong = new Mesh(this.geometries[13], this.materials[6]);
    checkLong.position.set(0.1, 0.035, -0.015);
    checkLong.rotation.y = 0.66;
    this.resolvedBadge.add(checkShort, checkLong);
    this.resolvedBadge.visible = false;
    this.group.add(this.resolvedBadge);

    for (const [x, z] of [[-0.85, POLE_SIDEWALK_OFFSET_Z - 0.55], [0.85, POLE_SIDEWALK_OFFSET_Z - 0.55], [-0.85, POLE_SIDEWALK_OFFSET_Z + 0.55], [0.85, POLE_SIDEWALK_OFFSET_Z + 0.55]]) {
      const cone = new Mesh(this.geometries[9], this.materials[4]);
      cone.position.set(x, 0.275, z);
      cone.castShadow = true;
      this.cones.add(cone);
    }
    this.cones.visible = false;
    this.group.add(this.cones);

    for (const mesh of [this.workZoneDisk, this.workZoneRing]) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0.025, POLE_SIDEWALK_OFFSET_Z * 0.45);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }

  setState(status: 'ACTIVE' | 'MAINTENANCE' | 'RESOLVED', showAlert: boolean, selected = false): void {
    this.group.visible = true;
    this.alert.visible = showAlert && status === 'ACTIVE';
    this.resolvedBadge.visible = status === 'RESOLVED';
    this.cones.visible = status === 'MAINTENANCE';
    this.group.children[1].visible = status !== 'RESOLVED';
    this.headAssembly.rotation.z = status === 'RESOLVED' ? 0 : -0.18;
    this.lamp.visible = status === 'RESOLVED';
    this.lampGlow.visible = status === 'RESOLVED';
    this.lampLight.visible = status === 'RESOLVED';
    this.materials[5].emissiveIntensity = status === 'RESOLVED' ? 3.1 : 0;
    this.materials[1].color.set(status === 'RESOLVED' ? '#435b56' : '#39464e');
    this.materials[1].emissive?.set(status === 'RESOLVED' ? '#2c6b52' : '#000000');
    this.materials[1].emissiveIntensity = status === 'RESOLVED' ? 0.35 : 0;
    this.materials[0].color.set(selected ? '#ffe46f' : '#ff9f35');
    this.materials[0].emissive.set(selected ? '#8a6814' : '#6b2c00');
  }

  setWorkZoneState(state: 'hidden' | 'clear' | 'busy' | 'unprotected'): void {
    const visible = state !== 'hidden';
    this.workZoneDisk.visible = visible;
    this.workZoneRing.visible = visible;
    const color = state === 'clear' ? '#6de5aa' : state === 'unprotected' ? '#f3c762' : '#ff8068';
    this.workZoneDiskMaterial.color.set(color);
    this.workZoneRingMaterial.color.set(color);
    this.workZoneDiskMaterial.opacity = state === 'clear' ? 0.08 : 0.12;
  }

  setPhaseState(state: 'healthy' | 'warning' | 'broken' | 'repairing' | 'resolved', elapsedMs: number): void {
    const healthy = state === 'healthy' || state === 'resolved';
    this.setState(healthy ? 'RESOLVED' : state === 'repairing' ? 'MAINTENANCE' : 'ACTIVE', !healthy);
    this.setWorkZoneState('hidden');
    this.resolvedBadge.visible = state === 'resolved';
    const on = healthy || (state === 'warning' && Math.floor(elapsedMs / 170) % 3 !== 0);
    this.lamp.visible = on;
    this.lampGlow.visible = on;
    this.lampLight.visible = on;
    this.materials[5].emissiveIntensity = on ? 3.1 : 0;
  }

  update(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.elapsed += Math.min(delta, 0.05);
    if (this.workZoneRing.visible) {
      const pulse = 0.985 + Math.sin(this.elapsed * 2.8) * 0.015;
      this.workZoneRing.scale.setScalar(pulse);
      this.workZoneRingMaterial.opacity = 0.78 + Math.sin(this.elapsed * 2.8) * 0.12;
    }
    if (!this.lamp.visible) return;
    const pulse = 0.94 + Math.sin(this.elapsed * 3.2) * 0.06;
    this.lampGlow.scale.setScalar(pulse);
    this.lampLight.intensity = 2.8 + Math.sin(this.elapsed * 3.2) * 0.28;
  }

  private add(
    geometry: BufferGeometry, material: MeshStandardMaterial,
    position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotationX = 0,
  ): void {
    this.addTo(this.group, geometry, material, position, scale, rotationX);
  }

  private addTo(parent: Group, geometry: BufferGeometry, material: MeshStandardMaterial,
    position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotationX = 0): void {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.rotation.x = rotationX;
    mesh.castShadow = true;
    parent.add(mesh);
  }

  dispose(): void {
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.glowMaterial.dispose();
    this.workZoneDiskMaterial.dispose();
    this.workZoneRingMaterial.dispose();
    this.workZoneDiskGeometry.dispose();
    this.workZoneRingGeometry.dispose();
    this.group.clear();
  }
}
