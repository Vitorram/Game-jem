import {
  CanvasTexture,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Texturas geradas em canvas: nada de arquivos em /public, nada de carregamento
 * assíncrono. As imagens base usam cor própria; os mapas de relevo são derivados
 * delas em escala de cinza e não recebem conversão sRGB.
 */
export type TextureKey =
  | 'sand' | 'wetSand' | 'promenade' | 'road' | 'cycleway' | 'sea'
  | 'plaster' | 'panel' | 'crate' | 'grain' | 'shadow';

const SIZE = 256;

type Draw = (ctx: CanvasRenderingContext2D, random: () => number) => void;

type TextureSet = {
  color: CanvasTexture;
  bump: CanvasTexture;
};

/** Mesmo gerador linear usado no resto do jogo: textura idêntica a cada partida. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/** Pontinhos finos espalhados; o alicerce de areia, asfalto e reboco. */
function speckle(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  colors: string[],
  maxRadius = 1.6,
): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    const radius = 0.35 + random() * maxRadius;
    ctx.beginPath();
    ctx.arc(random() * SIZE, random() * SIZE, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Desenha a mesma linha deslocada em Y para fechar a costura vertical. */
function wrappedLine(
  ctx: CanvasRenderingContext2D,
  y: number,
  drawAt: (offsetY: number) => void,
): void {
  drawAt(y);
  if (y < SIZE * 0.25) drawAt(y + SIZE);
  if (y > SIZE * 0.75) drawAt(y - SIZE);
}

/** Onda senoidal com período inteiro: começa e termina na mesma altura. */
function wave(
  ctx: CanvasRenderingContext2D,
  y: number,
  amplitude: number,
  periods: number,
  width: number,
  color: string,
): void {
  wrappedLine(ctx, y, offsetY => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();

    for (let x = 0; x <= SIZE; x += 4) {
      const py = offsetY + Math.sin((x / SIZE) * Math.PI * 2 * periods) * amplitude;
      if (x === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }

    ctx.stroke();
  });
}

const RECIPES: Record<TextureKey, Draw> = {
  // Areia: grão fino, conchinhas claras e marcas de maré bem suaves.
  sand: (ctx, random) => {
    ctx.fillStyle = '#efd39a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    speckle(ctx, random, 2600, ['#e2c287', '#f7e2b4', '#d9b776', '#fff0cd']);

    for (let i = 0; i < 4; i++) {
      wave(ctx, (i + 0.5) * SIZE / 4, 7, 2, 9, 'rgba(255, 244, 214, 0.35)');
    }

    for (let i = 0; i < 4; i++) {
      wave(ctx, i * SIZE / 4, 6, 3, 4, 'rgba(195, 160, 104, 0.3)');
    }

    speckle(ctx, random, 110, ['#fffaf0', '#cdb189'], 2.4);

    // Pequenas manchas de umidade e conchinhas escuras espalhadas.
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = 'rgba(176, 140, 88, 0.12)';
      ctx.beginPath();
      ctx.ellipse(
        random() * SIZE,
        random() * SIZE,
        10 + random() * 26,
        6 + random() * 14,
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    speckle(ctx, random, 26, ['#b99a66', '#a88455'], 1.2);
  },

  // Areia molhada: mais escura e com brilho úmido, para a faixa da beira do mar.
  wetSand: (ctx, random) => {
    ctx.fillStyle = '#c4a06a';
    ctx.fillRect(0, 0, SIZE, SIZE);

    speckle(ctx, random, 2200, ['#b08a55', '#d0ae78', '#a57d4a', '#dcc08e']);

    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = 'rgba(110, 85, 50, 0.12)';
      ctx.beginPath();
      ctx.ellipse(
        random() * SIZE,
        random() * SIZE,
        12 + random() * 30,
        5 + random() * 12,
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    for (let i = 0; i < 3; i++) {
      wave(ctx, (i + 0.5) * SIZE / 3, 5, 2, 3, 'rgba(255, 250, 235, 0.28)');
    }
  },

  // Calçadão: pedra portuguesa clara com onda discreta e juntas.
  promenade: (ctx, random) => {
    ctx.fillStyle = '#e4ded2';
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (let i = 0; i < 3; i++) {
      wave(ctx, (i + 0.5) * SIZE / 3, 20, 1, 30, '#f7f3ea');
    }

    for (let i = 0; i < 3; i++) {
      wave(ctx, (i + 0.5) * SIZE / 3 + 30, 20, 1, 14, '#cdc4b2');
    }

    ctx.strokeStyle = 'rgba(150, 142, 128, 0.28)';
    ctx.lineWidth = 1.25;

    for (let i = 0; i <= 4; i++) {
      const position = i * SIZE / 4;

      ctx.beginPath();
      ctx.moveTo(position, 0);
      ctx.lineTo(position, SIZE);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, position);
      ctx.lineTo(SIZE, position);
      ctx.stroke();
    }

    speckle(ctx, random, 900, [
      'rgba(120,112,100,0.16)',
      'rgba(255,255,255,0.3)',
    ]);
  },

  // Asfalto: brita grossa sobre base escura, com remendos e marcas de pneu.
  road: (ctx, random) => {
    ctx.fillStyle = '#363f45';
    ctx.fillRect(0, 0, SIZE, SIZE);

    speckle(ctx, random, 3200, [
      '#3d464b',
      '#58646b',
      '#2f373b',
      '#67737a',
    ], 2.1);

    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? '90, 100, 106' : '48, 55, 60'}, 0.22)`;

      const width = 18 + random() * 50;

      ctx.beginPath();
      ctx.ellipse(
        random() * SIZE,
        random() * SIZE,
        width,
        width * 0.55,
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Trilhas de pneu, com a costura vertical fechada.
    for (let i = 0; i < 6; i++) {
      const baseY = SIZE * (i % 2 ? 0.3 : 0.7) + (random() - 0.5) * 24;
      ctx.strokeStyle = `rgba(28, 33, 36, ${0.08 + random() * 0.08})`;
      ctx.lineWidth = 6 + random() * 6;

      wrappedLine(ctx, baseY, offsetY => {
        ctx.beginPath();
        ctx.moveTo(0, offsetY);
        ctx.lineTo(SIZE, offsetY);
        ctx.stroke();
      });
    }

    // Pequenas manchas de óleo.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(24, 28, 31, 0.16)';
      ctx.beginPath();
      ctx.ellipse(
        random() * SIZE,
        random() * SIZE,
        4 + random() * 7,
        3 + random() * 5,
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  },

  // Ciclovia: pintura vermelha com desgaste leve.
  cycleway: (ctx, random) => {
    ctx.fillStyle = '#b83a2d';
    ctx.fillRect(0, 0, SIZE, SIZE);

    speckle(ctx, random, 2400, [
      '#a63226',
      '#c84436',
      '#992c21',
      '#d45243',
    ], 1.9);

    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = 'rgba(150, 90, 78, 0.18)';

      ctx.beginPath();
      ctx.ellipse(
        random() * SIZE,
        random() * SIZE,
        20 + random() * 40,
        14 + random() * 22,
        random() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Desgaste em riscos finos, como pintura sendo pisada.
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = 'rgba(255, 220, 205, 0.12)';
      ctx.lineWidth = 1 + random() * 2;
      ctx.beginPath();
      ctx.moveTo(random() * SIZE, 0);
      ctx.lineTo(random() * SIZE, SIZE);
      ctx.stroke();
    }
  },

  // Mar claro para permitir a variação de cor animada do material.
  sea: (ctx, random) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (let i = 0; i < 6; i++) {
      wave(ctx, i * SIZE / 6, 9, 2, 10, 'rgba(176, 226, 240, 0.55)');
    }

    for (let i = 0; i < 6; i++) {
      wave(ctx, i * SIZE / 6 + 14, 11, 3, 5, 'rgba(255, 255, 255, 0.85)');
    }

    speckle(ctx, random, 420, [
      'rgba(255,255,255,0.7)',
      'rgba(140,205,225,0.4)',
    ], 2.2);
  },

  // Reboco dos muros, em blocos deslocados.
  plaster: (ctx, random) => {
    ctx.fillStyle = '#657184';
    ctx.fillRect(0, 0, SIZE, SIZE);

    speckle(ctx, random, 1800, ['#5a6576', '#727f93', '#4f5a69']);

    ctx.strokeStyle = 'rgba(55, 63, 75, 0.5)';
    ctx.lineWidth = 2;

    const courses = 4;

    for (let row = 0; row <= courses; row++) {
      const y = row * SIZE / courses;

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SIZE, y);
      ctx.stroke();

      const shift = row % 2 ? SIZE / 4 : 0;

      for (let column = 0; column < 2; column++) {
        const x = (shift + column * SIZE / 2) % SIZE;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + SIZE / courses);
        ctx.stroke();
      }
    }
  },

  // Painel pintado: balcões, estação e tampos.
  panel: (ctx, random) => {
    ctx.fillStyle = '#e8e2d7';
    ctx.fillRect(0, 0, SIZE, SIZE);

    speckle(ctx, random, 1300, [
      'rgba(255,255,255,0.45)',
      'rgba(170,163,150,0.22)',
    ]);

    ctx.strokeStyle = 'rgba(160, 152, 138, 0.32)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, SIZE - 20, SIZE - 20);
  },

  // Caixotes de madeira do baú de cones.
  crate: (ctx, random) => {
    ctx.fillStyle = '#d8cbb0';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const planks = 4;

    for (let i = 0; i < planks; i++) {
      const y = i * SIZE / planks;

      ctx.fillStyle = i % 2 ? '#cfc0a2' : '#e0d4ba';
      ctx.fillRect(0, y, SIZE, SIZE / planks - 3);

      ctx.strokeStyle = 'rgba(126, 104, 74, 0.5)';
      ctx.lineWidth = 3;

      ctx.beginPath();
      ctx.moveTo(0, y + SIZE / planks - 2);
      ctx.lineTo(SIZE, y + SIZE / planks - 2);
      ctx.stroke();

      for (let v = 0; v < 5; v++) {
        ctx.strokeStyle = `rgba(150, 125, 90, ${0.1 + random() * 0.12})`;
        ctx.lineWidth = 1;

        const vy = y + 4 + random() * (SIZE / planks - 10);

        ctx.beginPath();

        for (let x = 0; x <= SIZE; x += 8) {
          ctx.lineTo(
            x,
            vy + Math.sin(x / SIZE * Math.PI * 2) * 2,
          );
        }

        ctx.stroke();
      }
    }
  },

  // Grão neutro, usado apenas para detalhes que recebem cor pelo material.
  grain: (ctx, random) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SIZE, SIZE);

    speckle(ctx, random, 1500, [
      'rgba(0,0,0,0.05)',
      'rgba(255,255,255,0.6)',
      'rgba(0,0,0,0.03)',
    ]);
  },

  // Sombra de contato: degradê radial com transparência, sob os objetos.
  shadow: ctx => {
    const gradient = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
    gradient.addColorStop(0, 'rgba(20, 28, 32, 0.85)');
    gradient.addColorStop(0.5, 'rgba(20, 28, 32, 0.45)');
    gradient.addColorStop(1, 'rgba(20, 28, 32, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SIZE, SIZE);
  },
};

/** Seeds fixas por textura para o resultado não mudar entre recargas. */
const SEEDS: Record<TextureKey, number> = {
  sand: 1031,
  wetSand: 1543,
  promenade: 2447,
  road: 3769,
  cycleway: 4211,
  sea: 5839,
  plaster: 6133,
  panel: 7297,
  crate: 8419,
  grain: 9013,
  shadow: 10111,
};

function createBumpCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = source.width;
  bumpCanvas.height = source.height;

  const sourceContext = source.getContext('2d');
  const bumpContext = bumpCanvas.getContext('2d');

  if (!sourceContext || !bumpContext) return bumpCanvas;

  const image = sourceContext.getImageData(0, 0, source.width, source.height);
  const pixels = image.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = Math.round(
      pixels[index] * 0.2126
      + pixels[index + 1] * 0.7152
      + pixels[index + 2] * 0.0722,
    );

    pixels[index] = luminance;
    pixels[index + 1] = luminance;
    pixels[index + 2] = luminance;
    pixels[index + 3] = 255;
  }

  bumpContext.putImageData(image, 0, 0);
  return bumpCanvas;
}

function configureTexture(
  texture: CanvasTexture,
  colorSpace: typeof SRGBColorSpace | typeof NoColorSpace,
): void {
  texture.colorSpace = colorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

/** Cache com dono: quem cria é quem chama dispose. */
export class TextureLibrary {
  private readonly cache = new Map<TextureKey, TextureSet>();
  private readonly variants = new Map<string, Texture>();
  private disposed = false;

  /**
   * Retorna null no servidor (sem canvas); nesse caso o material segue usando
   * apenas sua cor sólida, sem interromper SSR ou testes.
   */
  get(key: TextureKey): Texture | null {
    return this.getSet(key)?.color ?? null;
  }

  /** Mapa de relevo correspondente, em escala de cinza e sem conversão de cor. */
  getBump(key: TextureKey): Texture | null {
    return this.getSet(key)?.bump ?? null;
  }

  /**
   * Cria uma variante independente para malhas que ocupam mais de um tile,
   * como a apron. Assim o repeat não altera materiais do mapa principal.
   */
  getRepeated(
    key: TextureKey,
    repeatX: number,
    repeatY: number,
    bump = false,
  ): Texture | null {
    if (this.disposed) return null;

    const source = bump ? this.getBump(key) : this.get(key);
    if (!source) return null;

    const safeX = Math.max(0.001, repeatX);
    const safeY = Math.max(0.001, repeatY);
    const variantKey = `${key}:${bump ? 'bump' : 'color'}:${safeX}:${safeY}`;

    const cached = this.variants.get(variantKey);
    if (cached) return cached;

    const texture = source.clone();
    texture.name = `procedural-${key}-${bump ? 'bump' : 'color'}-${safeX}-${safeY}`;
    texture.repeat.set(safeX, safeY);
    texture.needsUpdate = true;

    this.variants.set(variantKey, texture);
    return texture;
  }

  private getSet(key: TextureKey): TextureSet | null {
    if (this.disposed || typeof document === 'undefined') return null;

    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;

    const context = canvas.getContext('2d');
    if (!context) return null;

    RECIPES[key](context, makeRandom(SEEDS[key]));

    const color = new CanvasTexture(canvas);
    color.name = `procedural-${key}-color`;
    configureTexture(color, SRGBColorSpace);

    const bump = new CanvasTexture(createBumpCanvas(canvas));
    bump.name = `procedural-${key}-bump`;
    configureTexture(bump, NoColorSpace);

    const set = { color, bump };
    this.cache.set(key, set);

    return set;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.cache.forEach(set => {
      set.color.dispose();
      set.bump.dispose();
    });

    this.variants.forEach(texture => texture.dispose());

    this.cache.clear();
    this.variants.clear();
  }
}