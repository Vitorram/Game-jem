export const GAME_CONFIG = {
  playerSpeed: 1.8,
  cameraHeight: 14,
  cameraCloseHeight: 9,
  // Recuo em relação à altura: vista superior inclinada (~53° do chão).
  cameraTilt: 0.75,
  worldLimit: 9,
  maxPixelRatio: 2,
  maxDelta: 0.05,
} as const;
