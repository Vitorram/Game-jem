export const GAME_CONFIG = {
  playerSpeed: 1.8,
  cameraFov: 45,
  cameraNear: 0.1,
  cameraFar: 100,
  cameraHeight: 14,
  cameraCloseHeight: 9,
  // Recuo em relação à altura: vista superior inclinada (~53° do chão).
  cameraTilt: 0.75,
  worldLimit: 9,
  maxPixelRatio: 2,
  maxDelta: 0.05,
} as const;


export const ORLA_CONFIG = {
  ground: { width: 22, depth: 22, color: '#eeb65a', roughness: 0.9, edgeMargin: 0.8 },
  background: '#a6dcd9',
  playerSpacing: 2.5,
  hemisphere: { skyColor: '#fff1cf', groundColor: '#c78144', intensity: 2.2 },
  sun: {
    color: '#ffdfaa', intensity: 2.8,
    position: { x: -6, y: 14, z: 8 },
    shadowMapSize: 1024,
    shadowExtent: 18,
    shadowNear: 0.5,
    shadowFar: 60,
    shadowBias: -0.0002,
    shadowNormalBias: 0.03,
  },
} as const;

/** Mesma óptica e seguimento do laboratório. O limite do chão pode reduzir a altura. */
export const ORLA_CAMERA = {
  fov: GAME_CONFIG.cameraFov,
  near: GAME_CONFIG.cameraNear,
  far: GAME_CONFIG.cameraFar,
  closeHeight: GAME_CONFIG.cameraCloseHeight,
  wideHeight: GAME_CONFIG.cameraHeight,
  tilt: GAME_CONFIG.cameraTilt,
  followSmoothing: 4,
  portraitAspect: 0.85,
  minAspect: 0.01,
  groundPadding: 0.02,
} as const;
