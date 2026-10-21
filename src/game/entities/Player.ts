
import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';

import { GAME_CONFIG } from '../config';

export type PlayerId = 1 | 2 | 3;

type PlayerAppearance = {
  name: string;
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  backpack: string;
  hairstyle: 'curly' | 'long' | 'blue';
  hasCap?: boolean;
};

const PLAYER_APPEARANCES: Record<PlayerId, PlayerAppearance> = {
  1: {
    name: 'Infraestrutura',
    skin: '#A96F4E',
    hair: '#241711',
    shirt: '#174E3C',
    pants: '#263A59',
    backpack: '#182A49',
    hairstyle: 'curly',
  },

  2: {
    name: 'Mobilidade',
    skin: '#D5A17D',
    hair: '#211913',
    shirt: '#6545B5',
    pants: '#34304E',
    backpack: '#252A48',
    hairstyle: 'long',
    hasCap: true,
  },

  3: {
    name: 'Análise de dados',
    skin: '#E6B38D',
    hair: '#244DAD',
    shirt: '#C85C2F',
    pants: '#293345',
    backpack: '#202B43',
    hairstyle: 'blue',
  },
};

export class Player {
  readonly mesh = new Group();

  readonly id: PlayerId;
  readonly name: string;

  private readonly limbs: Mesh[] = [];

  private readonly materials: MeshStandardMaterial[] = [];

  private elapsed = 0;

  constructor(id: PlayerId = 1) {
    this.id = id;

    const appearance = PLAYER_APPEARANCES[id];
    this.name = appearance.name;

    this.createCharacter(appearance);

    // O grupo fica no chão; as partes do corpo têm alturas próprias.
    this.mesh.position.set(0, 0, 0);
  }

  private createCharacter(appearance: PlayerAppearance) {
    const material = (color: string) => {
      const result = new MeshStandardMaterial({
        color,
        roughness: 0.85,
      });

      this.materials.push(result);
      return result;
    };

    const skin = material(appearance.skin);
    const hair = material(appearance.hair);
    const shirt = material(appearance.shirt);
    const pants = material(appearance.pants);
    const backpack = material(appearance.backpack);
    const shoes = material('#E7E6E0');
    const dark = material('#273047');

    const addPart = (
      geometry: BoxGeometry | CapsuleGeometry | SphereGeometry,
      partMaterial: MeshStandardMaterial,
      position: [number, number, number],
      scale?: [number, number, number],
    ) => {
      const part = new Mesh(geometry, partMaterial);

      part.position.set(...position);

      if (scale) {
        part.scale.set(...scale);
      }

      part.castShadow = true;
      part.receiveShadow = true;

      this.mesh.add(part);

      return part;
    };

    // Mochila nas costas.
    addPart(
      new BoxGeometry(0.39, 0.43, 0.19),
      backpack,
      [0, 0.77, -0.22],
    );

    addPart(
      new BoxGeometry(0.25, 0.15, 0.025),
      dark,
      [0, 0.70, -0.325],
    );

    // Corpo e cabeça.
    addPart(
      new CapsuleGeometry(0.22, 0.32, 4, 10),
      shirt,
      [0, 0.78, 0],
    );

    addPart(
      new CapsuleGeometry(0.065, 0.07, 3, 8),
      skin,
      [0, 1.05, 0],
    );

    addPart(
      new SphereGeometry(0.18, 16, 12),
      skin,
      [0, 1.22, 0.025],
      [0.95, 1.08, 0.9],
    );

    // Cabelos e boné.
    if (appearance.hairstyle === 'curly') {
      addPart(
        new SphereGeometry(0.19, 12, 10),
        hair,
        [0, 1.34, -0.005],
        [1.12, 0.8, 1.05],
      );

      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2;

        addPart(
          new SphereGeometry(0.075, 8, 8),
          hair,
          [
            Math.cos(angle) * 0.145,
            1.34 + Math.sin(i * 2.1) * 0.035,
            Math.sin(angle) * 0.12,
          ],
        );
      }
    } else if (appearance.hairstyle === 'long') {
      addPart(
        new SphereGeometry(0.19, 12, 10),
        hair,
        [0, 1.33, -0.035],
        [1.08, 0.75, 1],
      );

      addPart(
        new CapsuleGeometry(0.12, 0.38, 4, 8),
        hair,
        [0, 0.91, -0.15],
        [1, 1, 0.8],
      );
    } else {
      addPart(
        new SphereGeometry(0.19, 12, 10),
        hair,
        [0, 1.34, 0],
        [1.1, 0.78, 1.05],
      );

      for (const x of [-0.15, 0.15]) {
        addPart(
          new SphereGeometry(0.075, 8, 8),
          hair,
          [x, 1.20, -0.035],
          [0.9, 1.25, 1],
        );
      }
    }

    if (appearance.hasCap) {
      const cap = material('#DCC9A7');

      addPart(
        new SphereGeometry(0.19, 12, 8),
        cap,
        [0, 1.39, 0.025],
        [1.08, 0.35, 1.05],
      );

      addPart(
        new BoxGeometry(0.28, 0.035, 0.17),
        cap,
        [0, 1.36, 0.14],
      );
    }

    // Braços: ficam articulados para a caminhada.
    const leftArm = addPart(
      new CapsuleGeometry(0.065, 0.26, 4, 8),
      shirt,
      [-0.27, 0.77, 0],
    );

    const rightArm = addPart(
      new CapsuleGeometry(0.065, 0.26, 4, 8),
      shirt,
      [0.27, 0.77, 0],
    );

    // Pernas.
    const leftLeg = addPart(
      new CapsuleGeometry(0.075, 0.24, 4, 8),
      pants,
      [-0.105, 0.36, 0],
    );

    const rightLeg = addPart(
      new CapsuleGeometry(0.075, 0.24, 4, 8),
      pants,
      [0.105, 0.36, 0],
    );

    this.limbs.push(leftArm, rightArm, leftLeg, rightLeg);

    // Tênis.
    for (const x of [-0.105, 0.105]) {
      addPart(
        new SphereGeometry(0.085, 10, 8),
        shoes,
        [x, 0.14, 0.055],
        [1, 0.55, 1.35],
      );
    }

    // Identificador colorido na mochila.
    const badgeColors: Record<PlayerId, string> = {
      1: '#56C9A0',
      2: '#D8B8FF',
      3: '#79B8FF',
    };

    addPart(
      new BoxGeometry(0.10, 0.10, 0.025),
      material(badgeColors[this.id]),
      [0, 0.88, -0.325],
    );

    // Sombra simples sob o personagem.
    const shadow = new Mesh(
      new SphereGeometry(0.29, 16, 8),
      material('#263629'),
    );

    shadow.scale.set(1, 0.035, 0.8);
    shadow.position.set(0, 0.035, 0);
    shadow.castShadow = false;
    shadow.receiveShadow = false;

    this.mesh.add(shadow);
  }

  update(delta: number, axis: { x: number; z: number }) {
    const distance = GAME_CONFIG.playerSpeed * delta;
    const limit = GAME_CONFIG.worldLimit;

    const x = Math.max(-1, Math.min(1, axis.x));
    const z = Math.max(-1, Math.min(1, axis.z));

    const moving = x !== 0 || z !== 0;

    if (moving) {
      // Normaliza a direção para que a diagonal não seja mais rápida.
      const length = Math.sqrt(x * x + z * z);
      const dx = x / length;
      const dz = z / length;

      this.mesh.position.x = MathUtils.clamp(
        this.mesh.position.x + dx * distance,
        -limit,
        limit,
      );

      this.mesh.position.z = MathUtils.clamp(
        this.mesh.position.z + dz * distance,
        -limit,
        limit,
      );

      this.mesh.rotation.y = Math.atan2(dx, dz);

      // Animação simples de caminhada.
      this.elapsed += delta;

      const swing = Math.sin(this.elapsed * 10) * 0.45;

      this.limbs[0].rotation.x = swing;
      this.limbs[1].rotation.x = -swing;
      this.limbs[2].rotation.x = -swing;
      this.limbs[3].rotation.x = swing;
    } else {
      // Retorna os membros à posição neutra.
      for (const limb of this.limbs) {
        limb.rotation.x = MathUtils.damp(
          limb.rotation.x,
          0,
          8,
          delta,
        );
      }
    }
  }

  setPosition(x: number, z: number) {
    this.mesh.position.set(x, 0, z);
  }

  dispose() {
    this.mesh.traverse(object => {
      const part = object as Mesh;
      part.geometry?.dispose();
    });

    this.materials.forEach(material => material.dispose());
  }
}
