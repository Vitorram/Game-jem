import {
  Scene, Color, HemisphereLight, DirectionalLight, MathUtils, Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import type { Scene as GameScene } from '../core/Scene';
import type { Input } from '../core/Input';
import { suburbanGameState, type ResponseTeam } from '../core/GameState';
import { Player, type PlayerId } from '../entities/Player';
import { GRID_CONFIG, ORLA_CONFIG, ORLA_CAMERA } from '../config';

import { GridMap } from '../map/GridMap';
import { GridMapView } from '../map/GridMapView';
import { ItemInteractions } from '../items/ItemInteractions';
import { ItemVisuals } from '../items/ItemVisuals';
import { RiskWorkflow, type RiskSnapshot } from '../risks/RiskWorkflow';
import { ORLA_RISKS, ORLA_ROUTE } from '../risks/riskData';
import { ORLA_MAP } from '../map/orlaMap';
import { TrafficSystem } from '../traffic/TrafficSystem';
import type { MobilityRoadAction } from '../traffic/TrafficSystem';
import { TrafficSignals } from '../traffic/TrafficSignals';
import { ActiveMobilitySystem } from '../traffic/ActiveMobilitySystem';
import { BrokenPoleMarker } from '../problems/BrokenPoleMarker';
import { TeamObjectiveMarker } from '../problems/TeamObjectiveMarker';
import { AnalystCabin } from './AnalystCabin';
import { OrlaPhase } from './OrlaPhase';

export type MobilityTutorialSnapshot = {
  holdingCone: boolean;
  placedCones: number;
  atWorkZone: boolean;
  normalFlow: boolean;
  facingConeCrate: boolean;
};
export type InfrastructureTutorialSnapshot = { readyToRepair: boolean };

/** Cena da Orla; recursos prÃ³prios liberados em dispose. */
export class Fase1OrlaScene implements GameScene {
  readonly scene = new Scene();
  // MantÃ©m a mesma velocidade direta e resposta de movimento do laboratÃ³rio.
  readonly players = [new Player(1), new Player(2), new Player(3)];
  private readonly input: Pick<Input, 'getAxis' | 'isSprinting'>;
  private readonly idle = { x: 0, z: 0 };
  readonly map = new GridMap(ORLA_MAP, GRID_CONFIG.tileSize, GRID_CONFIG.playerRadius);
  private readonly mapView = new GridMapView(this.map);
  readonly traffic = new TrafficSystem(this.map);
  private readonly activeMobility = new ActiveMobilitySystem(this.map, this.traffic);
  private readonly trafficSignals = new TrafficSignals(this.map, this.traffic);
  readonly brokenPoleMarker: BrokenPoleMarker;
  private readonly objectiveMarker = new TeamObjectiveMarker();
  private readonly analystCabin: AnalystCabin;
  private readonly spawnPositions = new Map<PlayerId, { x: number; z: number }>();
  readonly items = new ItemInteractions(this.map, this.players.map(player => player.id));
  private readonly itemVisuals = new ItemVisuals(this.map, this.mapView.group, this.players);
  readonly risks = new RiskWorkflow(
    ORLA_RISKS.map(risk => ({ ...risk, point: this.map.cellCenter(risk.column, risk.row) })),
    { stops: ORLA_ROUTE.stops.map(cell => this.map.cellCenter(cell.column, cell.row)), movedIndex: ORLA_ROUTE.movedIndex,
      destination: this.map.cellCenter(ORLA_ROUTE.destination.column, ORLA_ROUTE.destination.row) },
  );
  private readonly resolveMovement = this.map.resolveMovement.bind(this.map);
  private readonly resolveOrlaMovement = (from: { x: number; z: number }, to: { x: number; z: number }) => {
    const resolved = this.map.resolveMovement(from, to);
    const crate = this.map.cellCenter(this.map.itemSources[0].column, this.map.itemSources[0].row);
    const radius = GRID_CONFIG.playerRadius;
    const left = crate.x - 0.95 - radius, right = crate.x + 0.95 + radius;
    const near = crate.z - 0.78 - radius, far = crate.z + 0.78 + radius;
    let { x, z } = resolved;
    if (from.z > near && from.z < far) {
      if (from.x <= left && x > left) x = left;
      if (from.x >= right && x < right) x = right;
    }
    if (x > left && x < right) {
      if (from.z <= near && z > near) z = near;
      if (from.z >= far && z < far) z = far;
    }
    return { x, z };
  };
  private readonly resolveInfrastructureMovement = (from: { x: number; z: number }, to: { x: number; z: number }) =>
    this.traffic.resolveWorkerMovement(from, this.resolveOrlaMovement(from, to), GRID_CONFIG.playerRadius);
  private readonly sun: DirectionalLight;
  private disposed = false;
  private readonly cameraTarget = new Vector3();
  private cameraHeight: number = ORLA_CAMERA.closeHeight;
  private lastObjectiveDistance: number | null = null;
  private missionStep = 0;
  private returningConeToCrate = false;
  private tutorialMovementEnabled = true;
  private tutorialCollisionProtected = false;
  private collisionRecovery: { player: Player; elapsed: number; from: { x: number; z: number }; spawn: { x: number; z: number }; push: { x: number; z: number }; respawned: boolean } | null = null;
  private collisionInvulnerability = 0;
  private phase: OrlaPhase | null = null;

  startPhase(onStep: (id: string, step: number) => void): void {
    if (this.phase) return;
    this.phase = new OrlaPhase(this.map, this.traffic, this.activeMobility, this.items,
      this.brokenPoleMarker, () => this.onRepairPuzzleStart?.(), onStep);
    this.scene.add(this.phase.group);
    this.itemVisuals.sync(this.items);
    this.objectiveMarker.setVisible(false);
    this.returningConeToCrate = false;
    this.updateProblemPresentation();
  }

  advancePhase(elapsedMs: number): void { this.phase?.advance(elapsedMs); }

  get player() { return this.players[suburbanGameState.activeCharacter - 1]; }

  private currentInteractionPrompt: string | null = null;
  constructor(input: Pick<Input, 'getAxis' | 'isSprinting'> = { getAxis: () => ({ x: 0, z: 0 }), isSprinting: () => false }, private readonly onRisks?: (state: RiskSnapshot) => void, private readonly onInteractionPrompt?: (prompt: string | null) => void, private readonly onRepairPuzzleStart?: () => void, private readonly onObjectiveDistance?: (distance: number | null) => void, private readonly onMissionStep?: (step: number) => void) {
    this.input = input;
    suburbanGameState.setActiveCharacter(3);
    const { hemisphere, sun } = ORLA_CONFIG;
    this.scene.background = new Color(ORLA_CONFIG.background);
    this.scene.add(new HemisphereLight(hemisphere.skyColor, hemisphere.groundColor, hemisphere.intensity));
    this.sun = new DirectionalLight(sun.color, sun.intensity);
    this.sun.position.set(sun.position.x, sun.position.y, sun.position.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(sun.shadowMapSize, sun.shadowMapSize);
    Object.assign(this.sun.shadow.camera, {
      left: -sun.shadowExtent, right: sun.shadowExtent,
      top: sun.shadowExtent, bottom: -sun.shadowExtent,
      near: sun.shadowNear, far: sun.shadowFar,
    });
    this.sun.shadow.bias = sun.shadowBias;
    this.sun.shadow.normalBias = sun.shadowNormalBias;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);
    const brokenPole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1')!;
    this.brokenPoleMarker = new BrokenPoleMarker(brokenPole.position);
    const analystSpawn = this.map.spawns[2];
    this.analystCabin = new AnalystCabin(analystSpawn.x, analystSpawn.z);
    this.scene.add(this.mapView.group, this.traffic.group, this.activeMobility.group, this.trafficSignals.group, this.brokenPoleMarker.group, this.objectiveMarker.group, this.analystCabin.group);
    this.players.forEach((player, index) => {
      const spawn = index === 2 ? analystSpawn : this.map.spawns[index];
      player.setPosition(spawn.x, spawn.z - (index === 2 ? 0.3 : 0));
      this.spawnPositions.set(player.id, { x: player.position.x, z: player.position.z });
      player.setSeated(index === 2);
      this.scene.add(player.mesh);
    });
    this.syncRisks();
  }

  selectPlayer(id: PlayerId): void {
    if (this.disposed) return;
    this.stopMovement();
    suburbanGameState.setActiveCharacter(id);
    if (this.risks.selectRole(id)) this.syncRisks();
  }

  interact(): void {
    if (this.disposed) return;
    if (this.phase) {
      this.phase.interact(this.player);
      this.itemVisuals.sync(this.items);
      return;
    }
    if (this.player.role === 'analista') {
      const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
      if (pole && pole.status !== 'RESOLVED') {
        if (suburbanGameState.snapshot().selectedProblemId !== pole.id) {
          suburbanGameState.selectProblem(pole.id);
          this.updateProblemPresentation();
          return;
        }
        const nextTeam = !pole.dispatchedTeams.includes('infraestrutura') ? 'infraestrutura'
          : !pole.dispatchedTeams.includes('mobilidade') ? 'mobilidade' : null;
        if (nextTeam) this.dispatchTeam(nextTeam);
      }
      return;
    }
    if (this.player.role === 'mobilidade') {
      const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
      if (!pole?.dispatchedTeams.includes('mobilidade')) return;
      const playerId = suburbanGameState.activeCharacter;
      const position = this.player.mesh.position;
      const held = this.items.heldBy(playerId);
      const roadId = this.traffic.getNearbyLane(this.player.mesh.position.x, this.player.mesh.position.z);
      const source = this.items.tileInFront(playerId, position);
      const facingCrate = !!source && this.map.tileAt(source.column, source.row) === 'itemBox';
      if (held === 'cone' && facingCrate && this.items.consume(playerId, 'cone')) {
        this.returningConeToCrate = false;
        this.itemVisuals.sync(this.items);
        return;
      }
      const polePosition = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1')?.position;
      const placementPoint = polePosition ? this.traffic.getWorkZoneApproachPosition(polePosition) : null;
      const atWorkZone = !!placementPoint
        && Math.hypot(position.x - placementPoint.x, position.z - placementPoint.z) <= 1.6;
      if (held === 'cone' && roadId && atWorkZone) {
        const road = suburbanGameState.snapshot().roads.find(candidate => candidate.id === roadId);
        if (road?.type === 'PRINCIPAL' && this.traffic.placeConeAt(roadId, position.x)) {
          this.items.consume(playerId, 'cone');
          this.returningConeToCrate = false;
          this.itemVisuals.sync(this.items);
        }
        return;
      }
      if (held === null && roadId && this.traffic.removeNearestCone(position.x, position.z)) {
        this.items.give(playerId, 'cone');
        this.returningConeToCrate = true;
        this.itemVisuals.sync(this.items);
        return;
      }
      this.items.face(playerId, this.input.getAxis());
      const frontSource = this.items.tileInFront(playerId, position);
      if (frontSource && this.map.tileAt(frontSource.column, frontSource.row) === 'itemBox'
        && this.items.interact(playerId, position)) {
        this.returningConeToCrate = false;
        this.itemVisuals.sync(this.items);
      }
      return;
    }
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    if (this.player.role === 'infraestrutura' && pole && pole.status !== 'RESOLVED'
      && pole.dispatchedTeams.includes('infraestrutura')) {
      const dx = this.player.mesh.position.x - pole.position.x;
      const dz = this.player.mesh.position.z - pole.position.z;
      if (dx * dx + dz * dz <= 2.25) {
        const workZone = this.getWorkZoneReadiness(pole.position);
        if (workZone.prepared) {
          if (pole.status === 'ACTIVE') suburbanGameState.setProblemStatus(pole.id, 'MAINTENANCE');
          this.onRepairPuzzleStart?.();
        }
        this.updateProblemPresentation();
        return;
      }
    }
    this.items.face(suburbanGameState.activeCharacter, this.input.getAxis());
    const cell = this.items.tileInFront(suburbanGameState.activeCharacter, this.player.mesh.position);
    const source = cell && this.map.itemSources.find(item => item.column === cell.column && item.row === cell.row);
    if (source?.item === 'cone') return;
    if (cell && this.risks.interact(suburbanGameState.activeCharacter, cell)) {
      this.syncRisks();
      return;
    }
    if (this.items.interact(suburbanGameState.activeCharacter, this.player.mesh.position)) this.itemVisuals.sync(this.items);
  }

  dispatchTeam(team: ResponseTeam): boolean {
    if (this.disposed || this.player.role !== 'analista') return false;
    if (this.phase) {
      const state = suburbanGameState.snapshot();
      const selected = state.problems.find(problem => problem.id === state.selectedProblemId);
      if (!selected?.requiredTeams?.includes(team) || selected.dispatchedTeams.includes(team)) return false;
      suburbanGameState.dispatchTeam(selected.id, team);
      return true;
    }
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    if (!pole || pole.status === 'RESOLVED' || suburbanGameState.snapshot().selectedProblemId !== pole.id) return false;
    if (pole.dispatchedTeams.includes(team)) return false;
    suburbanGameState.dispatchTeam(pole.id, team);
    this.updateProblemPresentation();
    return true;
  }

  getMobilityTutorialSnapshot(): MobilityTutorialSnapshot {
    const state = suburbanGameState.snapshot();
    const pole = state.problems.find(problem => problem.id === 'broken-light-pole-1');
    const position = this.players[1].mesh.position;
    const laneId = this.traffic.getNearbyLane(position.x, position.z);
    const lane = state.roads.find(road => road.id === laneId);
    const approach = pole ? this.traffic.getWorkZoneApproachPosition(pole.position) : null;
    const placedCones = state.roads.filter(road => road.type === 'PRINCIPAL' && road.conesActive).length;
    const principalRoads = state.roads.filter(road => road.type === 'PRINCIPAL');
    const escapeRoad = state.roads.find(road => road.type === 'ESCAPE');
    const crateCell = this.items.tileInFront(2, position);
    return {
      holdingCone: this.items.heldBy(2) === 'cone',
      placedCones,
      facingConeCrate: !!crateCell && this.map.tileAt(crateCell.column, crateCell.row) === 'itemBox',
      atWorkZone: !!approach && lane?.type === 'PRINCIPAL'
        && Math.hypot(position.x - approach.x, position.z - approach.z) <= 1.6,
      normalFlow: principalRoads.length > 0
        && principalRoads.every(road => road.status === 'open' && road.direction === 'NORMAL')
        && escapeRoad?.status === 'blocked',
    };
  }

  getInfrastructureTutorialSnapshot(): InfrastructureTutorialSnapshot {
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    const position = this.players[0].mesh.position;
    return {
      readyToRepair: !!pole && pole.status !== 'RESOLVED'
        && pole.dispatchedTeams.includes('infraestrutura')
        && Math.hypot(position.x - pole.position.x, position.z - pole.position.z) <= 1.5
        && this.getWorkZoneReadiness(pole.position).prepared,
    };
  }

  useMobilityHotkey(key: string): boolean {
    if (this.disposed || this.player.role !== 'mobilidade') return false;
    if (this.phase) {
      const actions: Record<string, MobilityRoadAction> = { Digit1: 'release', Digit2: 'block', Digit3: 'blockAll', Digit4: 'escape' };
      return actions[key] ? this.phase.mobilityAction(this.player, actions[key]) : false;
    }
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    if (!pole?.dispatchedTeams.includes('mobilidade')) return false;
    const roadId = this.traffic.getNearbyLane(this.player.mesh.position.x, this.player.mesh.position.z);
    if (!roadId) return false;
    const actions: Record<string, MobilityRoadAction> = {
      Digit1: 'release', Digit2: 'block', Digit3: 'blockAll', Digit4: 'escape',
    };
    const action = actions[key];
    if (!action) return false;
    this.traffic.applyMobilityAction(roadId, action);
    return true;
  }

  toggleTraffic(): boolean { return this.traffic.toggleRunning(); }

  applyMobilityAction(roadId: string, action: MobilityRoadAction): void { this.traffic.applyMobilityAction(roadId, action); }

  completePoleRepair(): void {
    if (this.disposed || this.player.role !== 'infraestrutura') return;
    if (this.phase) { this.phase.completeRepair(); return; }
    const pole = suburbanGameState.snapshot().problems[0];
    if (!pole || pole.status !== 'MAINTENANCE' || !pole.dispatchedTeams.includes('infraestrutura')
      || Math.hypot(this.player.mesh.position.x - pole.position.x, this.player.mesh.position.z - pole.position.z) > 1.5
      || !this.getWorkZoneReadiness(pole.position).prepared) return;
    suburbanGameState.setProblemStatus('broken-light-pole-1', 'RESOLVED');
    this.reportMissionStep(3);
    this.updateProblemPresentation();
  }

  resetPoleAfterTutorialRepair(): void {
    if (this.disposed) return;
    const pole = suburbanGameState.snapshot().problems[0];
    if (pole?.status === 'MAINTENANCE') suburbanGameState.setProblemStatus(pole.id, 'ACTIVE');
    this.updateProblemPresentation();
  }

  private reportMissionStep(step: number): void {
    if (step !== this.missionStep + 1) return;
    this.missionStep = step;
    this.onMissionStep?.(step);
  }

  private syncRisks(): void {
    const state = this.risks.snapshot();
    this.onRisks?.(state);
  }

  private getWorkZoneReadiness(position: { x: number; z: number }) {
    return this.traffic.getWorkZoneReadiness(position, this.activeMobility.countCyclistsInWorkZone(position));
  }

  configureCamera(camera: PerspectiveCamera, aspect: number, closeView = true): void {
    if (this.disposed) return;
    camera.aspect = Math.max(aspect, ORLA_CAMERA.minAspect);
    camera.fov = ORLA_CAMERA.fov;
    camera.near = ORLA_CAMERA.near;
    camera.far = ORLA_CAMERA.far;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    this.updateCamera(camera, 0, closeView, true);
  }

  /** Limita a pegada inteira do frustum no chÃ£o, inclusive apÃ³s resize e zoom. */
  updateCamera(camera: PerspectiveCamera, dt: number, closeView: boolean, snap = false): void {
    if (this.disposed) return;
    const config = ORLA_CAMERA;
    const angle = Math.atan2(1, config.tilt);
    const sin = Math.sin(angle), cos = Math.cos(angle);
    const tan = Math.tan(MathUtils.degToRad(config.fov) / 2);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const denominator = sin - y * tan * cos;
      const px = x * tan * camera.aspect / denominator;
      const pz = config.tilt + (-cos - y * tan * sin) / denominator;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
    }
    const apron = closeView ? 0 : config.groundApron;
    const halfX = this.map.width / 2 + apron - config.groundPadding;
    const halfZ = this.map.depth / 2 + apron - config.groundPadding;
    const maxHeight = Math.min(2 * halfX / (maxX - minX), 2 * halfZ / (maxZ - minZ));
    const requestedHeight = (closeView ? config.closeHeight : config.wideHeight) * Math.max(1, config.portraitAspect / camera.aspect);
    const height = Math.min(maxHeight, requestedHeight);
    const blend = snap ? 1 : 1 - Math.exp(-config.followSmoothing * Math.max(0, dt));
    this.cameraHeight = Math.min(maxHeight, MathUtils.lerp(this.cameraHeight, height, blend));
    this.cameraTarget.lerp(this.player.mesh.position, blend);
    const h = this.cameraHeight;
    this.cameraTarget.x = MathUtils.clamp(this.cameraTarget.x, -halfX - minX * h, halfX - maxX * h);
    this.cameraTarget.z = MathUtils.clamp(this.cameraTarget.z, -halfZ - minZ * h, halfZ - maxZ * h);
    this.cameraTarget.y = 0;
    camera.position.set(this.cameraTarget.x, h, this.cameraTarget.z + h * config.tilt);
    camera.lookAt(this.cameraTarget);
    camera.updateMatrixWorld(true);
  }

  stopMovement(): void { this.players.forEach(player => player.stopMovement()); }

  setTutorialMovementEnabled(enabled: boolean): void {
    this.tutorialMovementEnabled = enabled;
    if (!enabled) this.player.stopMovement();
  }

  setTutorialCollisionProtection(active: boolean): void {
    this.tutorialCollisionProtected = active;
    if (active) this.collisionRecovery = null;
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.updateCollisionRecovery(dt);
    const recovering = !!this.collisionRecovery && !this.collisionRecovery.respawned;
    const axis = this.player.role === 'analista'
      || !this.tutorialMovementEnabled
      || (recovering && this.collisionRecovery?.player === this.player)
      ? this.idle : this.input.getAxis();
    if (dt > 0) this.items.face(suburbanGameState.activeCharacter, axis);
    this.mapView.update(dt);
    this.brokenPoleMarker.update(dt);
    const pedestrianPosition = this.player.role === 'analista' ? null : this.player.mesh.position;
    this.traffic.setPlayerPosition(pedestrianPosition);
    this.activeMobility.setPlayerPosition(pedestrianPosition);
    this.traffic.update(dt);
    this.activeMobility.update(dt);
    this.phase?.update(dt, this.player);
    this.trafficSignals.update();
    this.updateProblemPresentation();
    for (const player of this.players) {
      const movementResolver = player.active && player.role === 'infraestrutura' && !this.phase?.isServicing(player)
        ? this.resolveInfrastructureMovement : this.resolveOrlaMovement;
      if (!player.active) player.stopMovement();
      player.update(dt, player.active ? axis : this.idle, movementResolver, player.active && this.input.isSprinting());
    }
    if (!this.tutorialCollisionProtected && !recovering && this.collisionInvulnerability <= 0 && this.player.role !== 'analista') this.checkPlayerCollision();
  }

  private checkPlayerCollision(): void {
    if (this.phase?.isServicing(this.player)) return;
    const hitPlayer = this.player;
    const position = hitPlayer.mesh.position;
    const push = this.traffic.getPlayerCollision(position) ?? this.activeMobility.getPlayerCollision(position);
    if (!push) return;
    const spawn = this.spawnPositions.get(hitPlayer.id);
    if (!spawn) return;
    hitPlayer.stopMovement();
    this.collisionRecovery = {
      player: hitPlayer,
      elapsed: 0,
      from: { x: position.x, z: position.z },
      spawn: { ...spawn },
      push,
      respawned: false,
    };
  }

  private updateCollisionRecovery(dt: number): void {
    this.collisionInvulnerability = Math.max(0, this.collisionInvulnerability - dt);
    const recovery = this.collisionRecovery;
    if (!recovery) return;
    const player = recovery.player;
    recovery.elapsed += dt;
    const knockbackDuration = 0.28;
    if (recovery.elapsed < knockbackDuration) {
      const progress = recovery.elapsed / knockbackDuration;
      const eased = 1 - (1 - progress) ** 2;
      player.setPosition(recovery.from.x + recovery.push.x * 0.9 * eased, recovery.from.z + recovery.push.z * 0.9 * eased);
      player.mesh.position.y = Math.sin(progress * Math.PI) * 0.2;
      player.mesh.rotation.z = recovery.push.z * 0.42 * Math.sin(progress * Math.PI);
      return;
    }
    if (!recovery.respawned) {
      player.setPosition(recovery.spawn.x, recovery.spawn.z);
      recovery.respawned = true;
      this.collisionInvulnerability = 1.45;
    }
    const blinkTime = recovery.elapsed - knockbackDuration;
    player.mesh.visible = Math.floor(blinkTime * 14) % 2 === 0;
    if (blinkTime >= 1.45) {
      player.mesh.visible = true;
      player.mesh.rotation.z = 0;
      this.collisionRecovery = null;
    }
  }

  private updateProblemPresentation(): void {
    if (this.phase) {
      const { target, prompt } = this.phase.guidance(this.player);
      this.traffic.setMobilityView(this.player.role === 'mobilidade');
      this.objectiveMarker.setVisible(target !== null);
      const distance = target ? Math.round(this.objectiveMarker.update(this.player.position, target)) : null;
      if (distance !== this.lastObjectiveDistance) {
        this.lastObjectiveDistance = distance;
        this.onObjectiveDistance?.(distance);
      }
      if (prompt !== this.currentInteractionPrompt) {
        this.currentInteractionPrompt = prompt;
        this.onInteractionPrompt?.(prompt);
      }
      return;
    }
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    const state = suburbanGameState.snapshot();
    if (pole) this.brokenPoleMarker.setState(pole.status, this.player.role === 'analista', state.selectedProblemId === pole.id);
    const workZone = pole ? this.getWorkZoneReadiness(pole.position) : null;
    const workZoneVisible = !!pole && pole.status !== 'RESOLVED' && pole.dispatchedTeams.includes('infraestrutura');
    this.brokenPoleMarker.setWorkZoneState(!workZoneVisible ? 'hidden'
      : workZone?.prepared ? 'clear'
        : workZone?.reason === 'CARS_IN_WORK_ZONE' ? 'busy' : 'unprotected');
    const team: ResponseTeam | null = this.player.role === 'infraestrutura' ? 'infraestrutura'
      : this.player.role === 'mobilidade' ? 'mobilidade' : null;
    const intervention = pole ? this.traffic.getActiveInterventionPosition(pole.position) : null;
    const objectiveVisible = !!pole && !!team && pole.dispatchedTeams.includes(team)
      && (pole.status !== 'RESOLVED' || (team === 'mobilidade' && intervention !== null));
    this.objectiveMarker.setVisible(objectiveVisible);
    if (objectiveVisible && pole) {
      const carryingCone = this.items.heldBy(2) === 'cone';
      const target = team === 'mobilidade'
        ? intervention ?? (carryingCone && !this.returningConeToCrate
          ? this.traffic.getWorkZoneApproachPosition(pole.position) : this.map.cellCenter(this.map.itemSources[0].column, this.map.itemSources[0].row)) : pole.position;
      const distance = Math.round(this.objectiveMarker.update(this.player.mesh.position, target));
      if (distance !== this.lastObjectiveDistance) {
        this.lastObjectiveDistance = distance;
        this.onObjectiveDistance?.(distance);
      }
    } else if (this.lastObjectiveDistance !== null) {
      this.lastObjectiveDistance = null;
      this.onObjectiveDistance?.(null);
    }
    const laneId = this.player.role === 'mobilidade'
      ? this.traffic.getNearbyLane(this.player.mesh.position.x, this.player.mesh.position.z) : null;
    const road = laneId ? suburbanGameState.snapshot().roads.find(item => item.id === laneId) : undefined;
    const nearCone = this.player.role === 'mobilidade'
      && this.traffic.getNearbyCone(this.player.mesh.position.x, this.player.mesh.position.z);
    const mobilityAssigned = !!pole?.dispatchedTeams.includes('mobilidade');
    const frontCell = this.items.tileInFront(suburbanGameState.activeCharacter, this.player.mesh.position);
    const facingConeCrate = this.player.role === 'mobilidade' && mobilityAssigned
      && !!frontCell && this.map.tileAt(frontCell.column, frontCell.row) === 'itemBox';
    const carryingCone = this.items.heldBy(suburbanGameState.activeCharacter) === 'cone';
    const dx = pole ? this.player.mesh.position.x - pole.position.x : Infinity;
    const dz = pole ? this.player.mesh.position.z - pole.position.z : Infinity;
    const nearPole = this.player.role === 'infraestrutura' && dx * dx + dz * dz <= 2.25;
    if (pole?.dispatchedTeams.length === 2) {
      this.reportMissionStep(1);
      if (workZone?.prepared) this.reportMissionStep(2);
    }
    this.traffic.setMobilityView(this.player.role === 'mobilidade');
    const prompt = road?.type === 'PRINCIPAL' ? !mobilityAssigned ? 'AGUARDE O ACIONAMENTO DA ANALISTA' : carryingCone ? this.returningConeToCrate ? 'LEVAR CONE AO BAÃš' : facingConeCrate ? 'GUARDAR CONE NO BAÃš' : 'SOLTAR CONE NA VIA' : nearCone ? 'RECOLHER CONE DA VIA' : 'VÃ AO BAÃš DE CONES'
      : facingConeCrate ? carryingCone ? 'GUARDAR CONE NO BAÃš' : 'PEGAR CONE DO BAÃš'
      : nearPole && pole?.status !== 'RESOLVED' && !pole?.dispatchedTeams.includes('infraestrutura') ? 'AGUARDE O ACIONAMENTO DA ANALISTA'
        : nearPole && pole?.status !== 'RESOLVED' && workZone?.prepared ? 'CÃRCULO LIVRE Â· E REPARAR POSTE'
        : nearPole && pole?.status !== 'RESOLVED' ? workZone?.reason === 'CARS_IN_WORK_ZONE' ? 'AGUARDE Â· TRÃ‚NSITO NO CÃRCULO'
          : workZone?.reason === 'NEEDS_INTERVENTION' ? 'SINALIZE A ÃREA COM MOBILIDADE'
          : workZone?.reason === 'ACCESS_TOO_NARROW' ? 'ACESSO FÃSICO INSUFICIENTE'
            : 'ÃREA INSEGURA Â· PREPARE COM MOBILIDADE' : null;
    if (prompt !== this.currentInteractionPrompt) {
      this.currentInteractionPrompt = prompt;
      this.onInteractionPrompt?.(prompt);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.phase?.dispose();
    this.itemVisuals.dispose();
    this.activeMobility.dispose();
    this.traffic.dispose();
    this.brokenPoleMarker.dispose();
    this.objectiveMarker.dispose();
    this.analystCabin.dispose();
    this.players.forEach(player => player.dispose());
    this.mapView.dispose();
    this.sun.shadow.dispose();
    this.scene.clear();
    this.scene.background = null;
    this.trafficSignals.dispose();
  }
}

