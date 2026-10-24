import { Group, Mesh, MeshStandardMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { WorldSign } from './WorldSign';

/** Pequeno posto de observação aberto para a câmera, junto à estação existente. */
export class AnalystCabin {
  readonly group = new Group();
  private readonly geometry = new RoundedBoxGeometry(1, 1, 1, 2, .035);
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private disposed = false;
  private readonly sign = new WorldSign('SUBURBAN', 'CENTRAL DA ORLA', 2.16, .60);

  constructor(x: number, z: number) {
    this.group.name = 'analyst-observation-cabin';
    this.group.position.set(x, 0, z);
    this.box('platform', '#d5c6a7', [2.35, 0.12, 2.15], [0, 0.06, 0]);
    // Paredes laterais e fundo deixam a cabine legível sem esconder quem está dentro.
    this.box('left-wall', '#547878', [0.12, 1.55, 1.95], [-1.1, 0.84, -0.02]);
    this.box('right-wall', '#547878', [0.12, 1.55, 1.95], [1.1, 0.84, -0.02]);
    this.box('rear-wall', '#547878', [2.3, 1.55, 0.12], [0, 0.84, -0.94]);
    this.box('left-window', '#a9d8d1', [0.035, 0.78, 1.55], [-1.025, 1.0, -0.02]);
    this.box('right-window', '#a9d8d1', [0.035, 0.78, 1.55], [1.025, 1.0, -0.02]);
    this.box('roof-sign', '#e7b75c', [2.45, 0.13, 0.2], [0, 1.68, -0.87]);
    this.sign.mesh.position.set(0,1.9,-.79);
    this.group.add(this.sign.mesh);
    this.box('sign-support', '#173c42', [2.3,.68,.08], [0,1.9,-.85]);
    // Cadeira e estação de trabalho ficam voltadas para a abertura frontal.
    this.box('chair-seat', '#34465b', [0.6, 0.13, 0.55], [0, 0.36, -0.48]);
    this.box('chair-back', '#34465b', [0.6, 0.52, 0.13], [0, 0.65, -0.73]);
    this.box('chair-pedestal', '#7e8b8a', [0.12, 0.24, 0.12], [0, 0.22, -0.48]);
    this.box('desk-top', '#b88655', [1.85, 0.14, 0.66], [0, 0.65, 0.48]);
    this.box('desk-front', '#815f49', [1.65, 0.46, 0.12], [0, 0.34, 0.69]);
    this.box('monitor', '#29394b', [0.76, 0.48, 0.12], [0, 1.01, 0.36]);
    this.box('monitor-screen', '#74d9d0', [0.64, 0.35, 0.025], [0, 1.02, 0.29]);
    this.box('monitor-stand', '#586a76', [0.1, 0.12, 0.1], [0, 0.82, 0.36]);
    this.box('keyboard', '#34465b', [0.62, 0.035, 0.22], [0, 0.75, 0.1]);
    this.box('side-console', '#d3a15e', [0.36, 0.12, 0.3], [-0.62, 0.75, 0.45]);
  }

  private box(name: string, color: string, size: [number, number, number], position: [number, number, number]): void {
    let material = this.materials.get(color);
    if (!material) {
      material = new MeshStandardMaterial({ color, roughness: 0.72, transparent: color === '#a9d8d1', opacity: color === '#a9d8d1' ? 0.48 : 1 });
      this.materials.set(color, material);
    }
    const mesh = new Mesh(this.geometry, material);
    mesh.name = `analyst-cabin-${name}`;
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sign.dispose();
    this.geometry.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.group.clear();
  }
}

