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
  background: '#a6dcd9',
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
  closeHeight: 9,
  wideHeight: 18,
  tilt: GAME_CONFIG.cameraTilt,
  followSmoothing: 4,
  portraitAspect: 0.85,
  minAspect: 0.01,
  groundPadding: 0.02,
  groundApron: 30,
} as const;

export const GRID_CONFIG = {
  tileSize: 2,
  playerRadius: 0.3,
  floorThickness: 0.2,
  roughness: 0.9,
} as const;

export const ITEM_VIEW_CONFIG = {
  size: 0.5,
  carriedHeight: 2.3,
  surfaceGap: 0.08,
  roughness: 0.65,
} as const;


/** Resposta rápida, com frenagem mais forte que a aceleração. Unidades por segundo. */
export const ORLA_MOVEMENT = {
  speed: 4.2, sprintMultiplier: 1.5, acceleration: 18, braking: 28,
  stopThreshold: 0.01, turnSmoothing: 16,
} as const;

export const ORLA_FEEDBACK = {
  ringInnerRadius: 0.42, ringOuterRadius: 0.52, ringHeight: 0.025,
  ringColor: '#fff2a6', actionColor: '#75f2ab', actionDuration: 0.24,
} as const;

/** Distância antes do poste onde a Mobilidade é orientada a colocar o cone. */
export const ORLA_INTERACTION = { coneApproachDistance: 3 } as const;
