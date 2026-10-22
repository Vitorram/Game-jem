/** Catálogo provisório: só dados, sem dependência do renderer. */
export const ITEM_TYPES = {
  sensor: { label: 'Sensor', color: '#55baff' },
  sign: { label: 'Placa', color: '#ffdc66' },
  cone: { label: 'Cone', color: '#f28353' },
} as const;
export type ItemId = keyof typeof ITEM_TYPES;
