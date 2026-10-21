import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry,
} from 'three';

/** Marco visual do poste quebrado; não bloqueia movimento nem pode ser reparado. */
export class BrokenPoleMarker {
  readonly group = new Group();
  private readonly alert = new Group();
  private readonly resolvedBadge = new Group();
  private readonly cones = new Group();
  private readonly geometries: BufferGeometry[] = [
    new TorusGeometry(0.62, 0.045, 6, 24),
    new CylinderGeometry(0.055, 0.08, 0.9, 8),
    new CylinderGeometry(0.045, 0.055, 0.56, 8),
    new ConeGeometry(0.34, 0.46, 3),
    new BoxGeometry(0.055, 0.18, 0.055),
    new SphereGeometry(0.045, 8, 6),
    new ConeGeometry(0.2, 0.55, 8),
    new SphereGeometry(0.14, 10, 8),
    new TorusGeometry(0.42, 0.045, 6, 20),
    new BoxGeometry(0.28, 0.08, 0.1),
    new BoxGeometry(0.48, 0.08, 0.1),
  ];
  private readonly materials = [
    new MeshStandardMaterial({ color: '#ff9f35', emissive: '#6b2c00', roughness: 0.7 }),
    new MeshStandardMaterial({ color: '#394147', roughness: 0.8 }),
    new MeshStandardMaterial({ color: '#ffd45c', emissive: '#593d00', roughness: 0.6 }),
    new MeshStandardMaterial({ color: '#252b30', roughness: 0.8 }),
    new MeshStandardMaterial({ color: '#ff8b32', roughness: 0.75 }),
    new MeshStandardMaterial({ color: '#ffe58a', emissive: '#ffd34e', emissiveIntensity: 2 }),
    new MeshStandardMaterial({ color: '#62dc9b', emissive: '#1d7046', emissiveIntensity: 1.15, roughness: 0.62 }),
  ];
  private readonly lamp = new Mesh(this.geometries[7], this.materials[5]);

  constructor(position: { x: number; z: number }) {
    this.group.name = 'broken-light-pole-problem';
    this.group.position.set(position.x, 0, position.z);
    this.add(this.geometries[0], this.materials[0], [0, 0.035, 0], [1, 1, 1], Math.PI / 2);
    this.add(this.geometries[1], this.materials[1], [0, 0.46, 0]);
    this.add(this.geometries[2], this.materials[1], [0.18, 0.98, 0], [1, 1, 1], -0.75);
    this.alert.position.set(0, 1.55, 0);
    this.addTo(this.alert, this.geometries[3], this.materials[2], [0, 0, 0]);
    this.addTo(this.alert, this.geometries[4], this.materials[3], [0, 0.01, 0]);
    this.addTo(this.alert, this.geometries[5], this.materials[3], [0, -0.12, 0]);
    this.group.add(this.alert);
    this.resolvedBadge.position.set(0, 1.56, 0);
    const resolvedRing = new Mesh(this.geometries[8], this.materials[6]);
    resolvedRing.rotation.x = Math.PI / 2;
    this.resolvedBadge.add(resolvedRing);
    const checkShort = new Mesh(this.geometries[9], this.materials[6]);
    checkShort.position.set(-0.07, 0.02, 0.03);
    checkShort.rotation.y = -0.68;
    const checkLong = new Mesh(this.geometries[10], this.materials[6]);
    checkLong.position.set(0.1, 0.035, -0.015);
    checkLong.rotation.y = 0.66;
    this.resolvedBadge.add(checkShort, checkLong);
    this.resolvedBadge.visible = false;
    this.group.add(this.resolvedBadge);
    this.lamp.position.set(0.19, 1.48, 0);
    this.lamp.visible = false;
    this.group.add(this.lamp);
    for (const [x, z] of [[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55]]) {
      const cone = new Mesh(this.geometries[6], this.materials[4]);
      cone.position.set(x, 0.275, z);
      cone.castShadow = true;
      this.cones.add(cone);
    }
    this.cones.visible = false;
    this.group.add(this.cones);
  }

  setState(status: 'ACTIVE' | 'MAINTENANCE' | 'RESOLVED', showAlert: boolean): void {
    this.group.visible = true;
    this.alert.visible = showAlert && status === 'ACTIVE';
    this.resolvedBadge.visible = status === 'RESOLVED';
    this.cones.visible = status === 'MAINTENANCE';
    this.group.children[0].visible = status !== 'RESOLVED';
    this.group.children[2].position.set(status === 'RESOLVED' ? 0 : 0.18, status === 'RESOLVED' ? 1.16 : 0.98, 0);
    this.group.children[2].rotation.z = status === 'RESOLVED' ? 0 : -0.75;
    this.lamp.visible = status === 'RESOLVED';
    this.materials[1].color.set(status === 'RESOLVED' ? '#435b56' : '#394147');
    this.materials[1].emissive?.set(status === 'RESOLVED' ? '#65d5a0' : '#000000');
    this.materials[1].emissiveIntensity = status === 'RESOLVED' ? 0.9 : 0;
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
    this.group.clear();
  }
}
