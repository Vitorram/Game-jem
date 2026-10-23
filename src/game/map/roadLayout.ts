/**
 * Geometria da avenida da Orla, em metros a partir da borda norte da via
 * (z = depth/2 − 3 × tileSize). Mapa, tráfego e travessia leem daqui para que
 * a pintura sempre coincida com o eixo por onde os carros realmente andam.
 */
export const ROAD_LAYOUT = {
  /** Faixa verde: ~1,2 m dá 32 cm de folga para cada lado de um carro de 0,56 m. */
  greenCenter: 0.6,
  greenWidth: 1.2,
  /** Distância do eixo da faixa verde ao carregador, junto ao bordo sul da pintura. */
  chargerOffset: 0.72,
  eastbound: [1.8, 2.76],
  westbound: [4.06, 5.02],
  eastDash: 2.28,
  westDash: 4.54,
  bottomEdge: 5.44,
  /** Canteiro central e refúgio da travessia, centrados entre os sentidos (65 cm de cada eixo). */
  median: 3.41,
} as const;
