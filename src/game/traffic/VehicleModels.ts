import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const VEHICLE_KINDS = ['hatch', 'sedan', 'suv', 'pickup', 'truck', 'bus', 'motorcycle'] as const;
export type VehicleKind = typeof VEHICLE_KINDS[number];
export type VehicleModel = { group: Group; wheels: Mesh[]; brakeLights: Mesh[]; length: number; width: number; kind: VehicleKind };

/** Modelos voltados para +Z. Geometrias e materiais pertencem à fábrica. */
export class VehicleModels {
  private readonly rounded = new RoundedBoxGeometry(1, 1, 1, 2, .12);
  private readonly box = new BoxGeometry(1, 1, 1);
  private readonly tire = new CylinderGeometry(1, 1, 1, 16);
  private readonly sphere = new SphereGeometry(1, 16, 10);
  private readonly materials = new Map<string, MeshStandardMaterial>();

  private material(color: string, glow = false) {
    const key = color + glow;
    if (!this.materials.has(key)) this.materials.set(key, new MeshStandardMaterial({ color, roughness: .65, ...(glow ? { emissive: color, emissiveIntensity: .5 } : {}) }));
    return this.materials.get(key)!;
  }

  create(kind: VehicleKind, color: string): VehicleModel {
    const group = new Group();
    group.name = `vehicle-${kind}`;
    const wheels: Mesh[] = [], brakeLights: Mesh[] = [];
    const part = (name: string, paint: string, x: number, y: number, z: number, w: number, h: number, l: number, flat = false, glow = false) => {
      const mesh = new Mesh(flat ? this.box : this.rounded, this.material(paint, glow));
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, l);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    const wheel = (x: number, z: number, radius = .23, thickness = .16) => {
      const mesh = new Mesh(this.tire, this.material('#29363e'));
      mesh.rotation.z = Math.PI / 2;
      mesh.scale.set(radius, thickness, radius);
      mesh.position.set(x, radius + .025, z);
      mesh.castShadow = true;
      group.add(mesh);
      wheels.push(mesh);
      for (const side of [-1, 1]) {
        const hub = new Mesh(this.tire, this.material('#d9e3da'));
        hub.rotation.z = Math.PI / 2;
        hub.scale.set(radius * .52, .018, radius * .52);
        hub.position.set(x + side * thickness * .53, radius + .025, z);
        group.add(hub);
      }
    };
    if (kind === 'motorcycle') {
      wheel(0, -.48, .24, .17); wheel(0, .5, .24, .17);
      part('engine', '#53636a', 0, .35, 0, .26, .26, .52);
      part('fuel-tank', color, 0, .63, .12, .35, .3, .42);
      part('seat', '#34414e', 0, .67, -.3, .29, .12, .46);
      part('fork', '#bac9c7', 0, .5, .43, .12, .54, .09);
      part('handlebar', '#34414e', 0, .8, .42, .65, .055, .08);
      part('headlight', '#fff1b3', 0, .68, .52, .21, .18, .08, false, true);
      brakeLights.push(part('tail-light', '#ff6958', 0, .65, -.56, .18, .08, .08, false, true));
      part('rider-jacket', '#e8b564', 0, .99, -.12, .36, .47, .27);
      for (const side of [-1, 1]) {
        part('rider-leg', '#40536a', side * .19, .56, -.12, .13, .36, .26);
        const arm = part('rider-arm', '#e8b564', side * .24, .93, .17, .12, .14, .45);
        arm.rotation.x = -.3;
      }
      const helmet = new Mesh(this.sphere, this.material(color));
      helmet.scale.set(.24, .25, .24); helmet.position.set(0, 1.37, -.09); group.add(helmet);
      part('helmet-visor', '#263c51', 0, 1.39, .1, .35, .12, .11);
      return { group, wheels, brakeLights, length: 1.5, width: .65, kind };
    }
    if (kind === 'truck') {
      const length = 3.15, width = 1.12;
      part('chassis', '#36434d', 0, .34, 0, width * .86, .2, length * .92);
      part('cab', color, 0, .86, .95, width * .94, .96, .98);
      part('windshield', '#729fa8', 0, 1.06, 1.445, width * .78, .38, .025, true);
      part('cargo-box', '#f4f1ea', 0, 1.04, -.48, width, 1.24, 1.82);
      part('cargo-stripe', color, 0, .98, -.48, width * 1.01, .16, 1.78, true);
      for (const side of [-1, 1]) {
        part('side-window', '#729fa8', side * width * .475, 1.05, 1.02, .025, .34, .44, true);
        part('mirror', '#29363e', side * width * .54, 1.02, 1.32, .12, .18, .12);
        part('headlight', '#fff0bb', side * width * .33, .56, length / 2 - .12, .22, .14, .04, false, true);
        brakeLights.push(part('tail-light', '#ff6958', side * width * .34, .48, -length / 2 + .16, .18, .12, .04, false, true));
        wheel(side * width * .46, .95, .27);
        wheel(side * width * .46, -.88, .27);
      }
      part('front-bumper', '#d9e0d7', 0, .36, 1.46, width * .92, .14, .12);
      part('rear-bumper', '#36434d', 0, .34, -1.42, width * .9, .12, .1);
      return { group, wheels, brakeLights, length, width, kind };
    }
    const bus = kind === 'bus', pickup = kind === 'pickup', suv = kind === 'suv';
    const length = bus ? 3.7 : pickup ? 2.5 : kind === 'sedan' ? 2.35 : suv ? 2.2 : 1.9;
    const width = bus ? 1.15 : suv || pickup ? 1.05 : .95;
    const height = bus ? 1.55 : suv ? 1.12 : .98;
    part('chassis', '#36434d', 0, .32, 0, width * .9, .18, length * .92);
    part('body', color, 0, bus ? .85 : .51, 0, width, bus ? 1.12 : .43, length);
    const cabinZ = pickup ? .35 : -.08;
    const cabinLength = bus ? length * .93 : pickup ? .98 : length * .57;
    if (!bus) part('cabin', color, 0, height - .22, cabinZ, width * .87, .52, cabinLength);
    const windowY = bus ? 1.22 : height - .18;
    part('windshield', '#729fa8', 0, windowY, bus ? length / 2 + .012 : cabinZ + cabinLength / 2, width * .75, bus ? .43 : .28, .025, true);
    part('rear-window', '#729fa8', 0, windowY, bus ? -length / 2 - .012 : cabinZ - cabinLength / 2, width * .72, bus ? .38 : .25, .025, true);
    for (const side of [-1, 1]) {
      const n = bus ? 6 : pickup ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const z = bus ? -1.35 + i * .5 : cabinZ + (i - (n - 1) / 2) * .5;
        part('side-window', '#729fa8', side * width * (bus ? .505 : .44), windowY, z, .025, bus ? .4 : .26, bus ? .4 : .39, true);
      }
      part('mirror', color, side * width * .56, bus ? 1.12 : .85, length * .31, .14, .12, .18);
      part('headlight', '#fff0bb', side * width * .31, .57, length / 2 + .018, .23, .13, .04, false, true);
      brakeLights.push(part('tail-light', '#ff6958', side * width * .32, .55, -length / 2 - .018, .17, .13, .04, false, true));
      wheel(side * width * .48, -length * .31, bus ? .29 : .23);
      wheel(side * width * .48, length * .31, bus ? .29 : .23);
      if (bus) {
        part('bus-cream-stripe', '#fff1ce', side * width * .505, .78, 0, .025, .16, length * .94, true);
        part('bus-door', '#405c66', side * width * .51, .74, 1.25, .027, 1, .38, true);
      }
      if (suv) part('roof-rail', '#d9e3da', side * .32, height + .09, -.08, .055, .07, 1.1);
    }
    if (pickup) {
      part('open-bed', '#46545a', 0, .745, -.72, width * .77, .035, .8);
      for (const side of [-1, 1]) part('bed-wall', color, side * width * .44, .79, -.72, .13, .22, .98);
      part('tailgate', color, 0, .79, -length / 2 + .07, width, .22, .12);
    }
    if (bus) {
      part('roof', '#fff1ce', 0, 1.45, 0, width * .96, .13, length * .97);
      part('route-display', '#293e46', 0, 1.43, length / 2 + .025, .72, .14, .04);
      part('route-display-lit', '#ffd36d', 0, 1.43, length / 2 + .05, .42, .045, .02, true, true);
    }
    part('front-bumper', '#e3e7d9', 0, .32, length / 2, width * .86, .1, .1);
    part('rear-bumper', '#e3e7d9', 0, .32, -length / 2, width * .86, .1, .1);
    part('plate', '#fff7df', 0, .44, -length / 2 - .025, .27, .1, .025, true);
    return { group, wheels, brakeLights, length, width, kind };
  }

  dispose() {
    for (const geometry of [this.rounded, this.box, this.tire, this.sphere]) geometry.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
  }
}
