import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Player, type PlayerAppearance, type PlayerId } from '../entities/Player';

export type NpcVisual = { mesh: Group; animate(dt: number, distance: number, turning?: number): void; dispose(): void };

export const WALKER_LOOKS: readonly PlayerAppearance[] = [
  { name: 'Passeio coral', role: 'analista', skin: '#e6b38d', hair: '#754c32', shirt: '#dc927d', pants: '#e2d6b8', backpack: '#bc9275', hairstyle: 'long', hideBackpack: true },
  { name: 'Passeio verde', role: 'analista', skin: '#86563d', hair: '#292329', shirt: '#78ad9b', pants: '#40556c', backpack: '#d8ae6e', hairstyle: 'curly' },
  { name: 'Passeio de boné', role: 'analista', skin: '#dca47b', hair: '#b8b7ad', shirt: '#e1bd69', pants: '#66766b', backpack: '#678d92', hairstyle: 'blue', hasCap: true, hideBackpack: true },
  { name: 'Passeio lilás', role: 'analista', skin: '#bf865e', hair: '#914d34', shirt: '#b7a2c9', pants: '#4a5268', backpack: '#d5948c', hairstyle: 'blue' },
];
const CYCLIST_LOOKS: readonly PlayerAppearance[] = [
  { name: 'Ciclista de passeio', role: 'analista', skin: '#c68c67', hair: '#5f3c2f', shirt: '#df9687', pants: '#506d75', backpack: '#fff', hairstyle: 'long', hideBackpack: true },
  { name: 'Ciclista esportivo', role: 'analista', skin: '#865a43', hair: '#292831', shirt: '#72aeca', pants: '#354153', backpack: '#fff', hairstyle: 'blue', hideBackpack: true },
  { name: 'Entregador 99Food', role: 'analista', skin: '#dba578', hair: '#302c29', shirt: '#e7bb48', pants: '#3d4854', backpack: '#ffd124', hairstyle: 'blue', hideBackpack: true },
];

/** Peças das bicicletas compartilhadas; cada boneco cuida do próprio esqueleto e materiais. */
export class NpcModels {
  private readonly box = new BoxGeometry(1, 1, 1);
  private readonly rounded = new RoundedBoxGeometry(1, 1, 1, 2, .12);
  private readonly cylinder = new CylinderGeometry(1, 1, 1, 10);
  private readonly sphere = new SphereGeometry(1, 12, 8);
  private readonly tire = new TorusGeometry(.26, .024, 6, 20);
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private labelTexture?: CanvasTexture;
  private labelMaterial?: MeshStandardMaterial;

  private material(color: string) {
    if (!this.materials.has(color)) this.materials.set(color, new MeshStandardMaterial({ color, roughness: .8 }));
    return this.materials.get(color)!;
  }
  private part(parent: Group, color: string, x: number, y: number, z: number, w: number, h: number, d: number, round = false) {
    const mesh = new Mesh(round ? this.rounded : this.box, this.material(color));
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private rod(parent: Group, color: string, start: number[], end: number[], radius = .025) {
    const a = new Vector3(...start), b = new Vector3(...end);
    const delta = b.clone().sub(a);
    const mesh = new Mesh(this.cylinder, this.material(color));
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.scale.set(radius, delta.length(), radius);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true; parent.add(mesh);
  }
  createWalker(index: number): NpcVisual {
    const variant = index % WALKER_LOOKS.length;
    const person = new Player((variant % 3 + 1) as PlayerId, false, { ...WALKER_LOOKS[variant], lowDetail: true });
    person.mesh.name = `orla-pedestrian-${variant}`;
    person.mesh.userData.appearance = WALKER_LOOKS[variant].name;
    return { mesh: person.mesh, animate: (dt, distance, turning) => person.animateWalking(dt, distance, turning), dispose: () => person.dispose() };
  }
  createCyclist(index: number): NpcVisual {
    const variant = index % CYCLIST_LOOKS.length;
    const root = new Group(), bike = new Group();
    root.name = `orla-cyclist-${variant}`;
    root.userData.appearance = CYCLIST_LOOKS[variant].name;
    // O fluxo usa +X; o boneco e a bicicleta são modelados voltados para +Z.
    bike.rotation.y = Math.PI / 2; root.add(bike);
    const color = ['#b3c99b', '#71a8c4', '#f4c740'][variant];
    const wheels: Group[] = [];
    for (const z of [-.4, .4]) {
      const wheel = new Group(); wheel.position.set(0, .285, z); bike.add(wheel); wheels.push(wheel);
      const tire = new Mesh(this.tire, this.material('#34424b')); tire.rotation.y = Math.PI / 2; tire.castShadow = true; wheel.add(tire);
      this.rod(wheel, '#d4e1dc', [0, 0, 0], [.06, 0, 0], .04);
      for (let i = 0; i < 2; i++) {
        const spoke = this.part(wheel, '#b8ccc9', 0, 0, 0, .014, .49, .014);
        spoke.rotation.x = i * Math.PI / 2;
        spoke.castShadow = false;
      }
    }
    const rear = [0, .285, -.4], front = [0, .285, .4], crank = [0, .3, .05], seat = [0, .64, -.08], neck = [0, .68, .34];
    for (const [a, b] of [[rear, crank], [crank, seat], [seat, rear], [seat, neck], [neck, crank], [neck, front]]) this.rod(bike, color, a, b);
    this.rod(bike, '#c6d6cf', neck, [0, .83, .4]);
    this.rod(bike, '#34424b', [-.23, .83, .4], [.23, .83, .4], .022);
    this.part(bike, '#34424b', 0, .665, -.08, .25, .06, .23, true);
    const pedals: Group[] = [];
    for (const side of [-1, 1]) {
      const pedal = new Group(); bike.add(pedal); pedals.push(pedal);
      this.part(pedal, '#34424b', 0, 0, 0, .17, .035, .1);
    }
    const person = new Player((variant + 1) as PlayerId, false, { ...CYCLIST_LOOKS[variant], lowDetail: true });
    person.mesh.position.y = .15; bike.add(person.mesh);
    const head = person.mesh.getObjectByName('head') as Group;
    const helmet = new Mesh(this.sphere, this.material(variant === 2 ? '#ffd12e' : variant === 1 ? '#edf3e5' : '#a3bf96'));
    helmet.name = 'cycling-helmet'; helmet.position.set(0, .38, -.01); helmet.scale.set(.265, .18, .255); helmet.castShadow = true; head.add(helmet);
    if (variant === 0) {
      this.part(bike, '#d5b48b', 0, .68, .54, .42, .28, .27, true);
      this.part(bike, '#a68865', 0, .825, .54, .36, .012, .21);
    }
    if (variant === 1) this.part(bike, '#d6e4d7', .045, .46, .12, .07, .18, .07, true);
    if (variant === 2) this.deliveryBag(person);
    const visual: NpcVisual = {
      mesh: root,
      animate: (dt, distance) => {
        person.animateCycling(dt, distance);
        for (const wheel of wheels) wheel.rotation.x += distance / .26;
        pedals.forEach((pedal, i) => {
          const phase = person.cyclingPhase + (i === 1 ? Math.PI : 0);
          pedal.position.set(i === 0 ? -.13 : .13, .3 + Math.sin(phase) * .1105, .052 + Math.cos(phase) * .1105);
        });
      },
      dispose: () => { person.dispose(); root.clear(); },
    };
    visual.animate(.001, 0);
    return visual;
  }

  createInjuredDeliveryWorker(): NpcVisual {
    const person = new Player(3, false, { ...CYCLIST_LOOKS[2], lowDetail: true });
    const root = new Group();
    root.name = 'injured-99food-delivery-worker';
    root.userData.appearance = 'Entregador 99Food ferido';
    root.add(person.mesh);
    this.deliveryBag(person);

    // A bicicleta fica ao lado do entregador, apoiada pelo braço enquanto ele
    // manca até a calçada segura.
    const bike = new Group();
    bike.position.set(-.48, .12, -.08);
    bike.rotation.y = Math.PI / 2;
    bike.rotation.z = -.16;
    root.add(bike);
    for (const z of [-.4, .4]) {
      const wheel = new Group(); wheel.position.set(0, .285, z); bike.add(wheel);
      const tire = new Mesh(this.tire, this.material('#34424b'));
      tire.rotation.y = Math.PI / 2; tire.castShadow = true; wheel.add(tire);
    }
    const rear = [0, .285, -.4], front = [0, .285, .4], crank = [0, .3, .05], seat = [0, .64, -.08], neck = [0, .68, .34];
    for (const [a, b] of [[rear, crank], [crank, seat], [seat, rear], [seat, neck], [neck, crank], [neck, front]]) {
      this.rod(bike, '#e7bd32', a, b, .032);
    }
    this.rod(bike, '#34424b', neck, [0, .83, .4], .025);
    this.rod(bike, '#34424b', [-.23, .83, .4], [.23, .83, .4], .025);

    let limpTime = 0;
    const visual: NpcVisual = {
      mesh: root,
      animate: (dt, distance, turning) => {
        limpTime += dt;
        person.animateWalking(dt, distance * .72, turning);
        root.rotation.z = Math.sin(limpTime * 7.5) * .055;
        bike.rotation.x = Math.sin(limpTime * 4) * .045;
      },
      dispose: () => { person.dispose(); root.clear(); },
    };
    visual.animate(.001, 0);
    return visual;
  }
  private deliveryBag(person: Player) {
    const torso = person.mesh.getObjectByName('torso') as Group;
    const bag = new Group(); bag.name = '99food-yellow-delivery-bag'; torso.add(bag);
    this.part(bag, '#ffd026', 0, .07, -.43, .6, .67, .4, true);
    this.part(bag, '#e8ad22', 0, .4, -.43, .62, .045, .42, true);
    this.part(bag, '#fff0a0', 0, -.18, -.637, .54, .045, .012);
    for (const side of [-1, 1]) {
      this.rod(torso, '#454b43', [side * .19, -.2, .14], [side * .2, .27, .08], .028);
      this.rod(torso, '#454b43', [side * .2, .27, .08], [side * .19, .25, -.3], .028);
    }
    if (!this.labelMaterial && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#ffd026'; context.fillRect(0, 0, 512, 256);
        context.fillStyle = '#272a25'; context.font = 'bold 105px Arial, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText('99Food', 256, 128);
        this.labelTexture = new CanvasTexture(canvas); this.labelTexture.colorSpace = SRGBColorSpace;
        this.labelMaterial = new MeshStandardMaterial({ map: this.labelTexture, roughness: .8 });
      }
    }
    if (this.labelMaterial) {
      for (const side of [0, -1, 1]) {
        const label = new Mesh(this.plane, this.labelMaterial); label.name = '99food-label';
        label.position.set(side * .303, .1, side === 0 ? -.635 : -.43);
        label.scale.set(side === 0 ? .53 : .34, .24, 1);
        label.rotation.y = side === 0 ? Math.PI : side * Math.PI / 2; bag.add(label);
      }
    }
  }
  dispose() {
    for (const geometry of [this.box, this.rounded, this.cylinder, this.sphere, this.tire, this.plane]) geometry.dispose();
    this.materials.forEach(material => material.dispose()); this.materials.clear();
    this.labelTexture?.dispose(); this.labelMaterial?.dispose();
  }
}
