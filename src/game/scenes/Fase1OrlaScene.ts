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
import { ActiveMobilitySystem } from '../traffic/ActiveMobilitySystem';
import { BrokenPoleMarker } from '../problems/BrokenPoleMarker';
import { TeamObjectiveMarker } from '../problems/TeamObjectiveMarker';

/** Cena da Orla; recursos próprios liberados em dispose. */
export class Fase1OrlaScene implements GameScene {
  readonly scene = new Scene();
  readonly players = [new Player(1), new Player(2), new Player(3)];
  private readonly input: Pick<Input, 'getAxis' | 'isSprinting'>;
  private readonly idle = { x: 0, z: 0 };
  readonly map = new GridMap(ORLA_MAP, GRID_CONFIG.tileSize, GRID_CONFIG.playerRadius);
  private readonly mapView = new GridMapView(this.map);
  readonly traffic = new TrafficSystem(this.map);
  private readonly activeMobility = new ActiveMobilitySystem(this.map, this.traffic);
  readonly brokenPoleMarker: BrokenPoleMarker;
  private readonly objectiveMarker = new TeamObjectiveMarker();
  readonly items = new ItemInteractions(this.map, this.players.map(player => player.id));
  private readonly itemVisuals = new ItemVisuals(this.map, this.mapView.group, this.players);
  readonly risks = new RiskWorkflow(
    ORLA_RISKS.map(risk => ({ ...risk, point: this.map.cellCenter(risk.column, risk.row) })),
    { stops: ORLA_ROUTE.stops.map(cell => this.map.cellCenter(cell.column, cell.row)), movedIndex: ORLA_ROUTE.movedIndex,
      destination: this.map.cellCenter(ORLA_ROUTE.destination.column, ORLA_ROUTE.destination.row) },
  );
  private readonly resolveMovement = this.map.resolveMovement.bind(this.map);
  private readonly resolveInfrastructureMovement = (from: { x: number; z: number }, to: { x: number; z: number }) =>
    this.traffic.resolveWorkerMovement(from, this.map.resolveMovement(from, to), GRID_CONFIG.playerRadius);
  private readonly sun: DirectionalLight;
  private disposed = false;
  private readonly cameraTarget = new Vector3();
  private cameraHeight: number = ORLA_CAMERA.closeHeight;
  private lastObjectiveDistance: number | null = null;

  get player() { return this.players[suburbanGameState.activeCharacter - 1]; }

  private currentInteractionPrompt: string | null = null;
  constructor(input: Pick<Input, 'getAxis' | 'isSprinting'> = { getAxis: () => ({ x: 0, z: 0 }), isSprinting: () => false }, private readonly onRisks?: (state: RiskSnapshot) => void, private readonly onInteractionPrompt?: (prompt: string | null) => void, private readonly onRepairPuzzleStart?: () => void, private readonly onObjectiveDistance?: (distance: number | null) => void) {
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
    this.scene.add(this.mapView.group, this.traffic.group, this.activeMobility.group, this.brokenPoleMarker.group, this.objectiveMarker.group);
    this.players.forEach((player, index) => {
      // A Analista começa no acesso da estação que funciona como sua cabine de observação.
      const spawn = index === 2 ? this.map.cellCenter(10, 5) : this.map.spawns[index];
      player.setPosition(spawn.x, spawn.z);
      this.scene.add(player.mesh);
    });
    this.syncRisks();
  }

  selectPlayer(id: PlayerId): void {
    if (this.disposed) return;
    suburbanGameState.setActiveCharacter(id);
    if (this.risks.selectRole(id)) this.syncRisks();
  }

  interact(): void {
    if (this.disposed) return;
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
      const roadId = this.traffic.getNearbyLane(this.player.mesh.position.x, this.player.mesh.position.z);
      if (roadId) {
        const road = suburbanGameState.snapshot().roads.find(candidate => candidate.id === roadId);
        if (road?.type !== 'PRINCIPAL') return;
        const position = this.player.mesh.position;
        if (!this.traffic.removeNearestCone(position.x, position.z)) this.traffic.placeConeAt(roadId, position.x);
      }
      return;
    }
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    if (this.player.role === 'infraestrutura' && pole && pole.status !== 'RESOLVED'
      && pole.dispatchedTeams.includes('infraestrutura')) {
      const dx = this.player.mesh.position.x - pole.position.x;
      const dz = this.player.mesh.position.z - pole.position.z;
      if (dx * dx + dz * dz <= 2.25) {
        const workZone = this.traffic.getWorkZoneReadiness(pole.position);
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
    if (cell && this.risks.interact(suburbanGameState.activeCharacter, cell)) {
      this.syncRisks();
      return;
    }
    if (this.items.interact(suburbanGameState.activeCharacter, this.player.mesh.position)) this.itemVisuals.sync(this.items);
  }

  dispatchTeam(team: ResponseTeam): boolean {
    if (this.disposed || this.player.role !== 'analista') return false;
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    if (!pole || pole.status === 'RESOLVED' || suburbanGameState.snapshot().selectedProblemId !== pole.id) return false;
    suburbanGameState.dispatchTeam(pole.id, team);
    this.updateProblemPresentation();
    return true;
  }

  useMobilityHotkey(key: string): boolean {
    if (this.disposed || this.player.role !== 'mobilidade') return false;
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    if (!pole?.dispatchedTeams.includes('mobilidade')) return false;
    const roadId = this.traffic.getNearbyLane(this.player.mesh.position.x, this.player.mesh.position.z);
    if (!roadId) return false;
    const actions: Record<string, MobilityRoadAction> = {
      Digit1: 'release', Digit2: 'block', Digit3: 'reverse', Digit4: 'escape',
      Digit5: 'redirect',
    };
    const action = actions[key];
    if (!action) return false;
    this.traffic.applyMobilityAction(roadId, action);
    return true;
  }

  toggleTraffic(): boolean { return this.traffic.toggleRunning(); }

  applyMobilityAction(roadId: string, action: MobilityRoadAction): void { this.traffic.applyMobilityAction(roadId, action); }

  completePoleRepair(): void {
    suburbanGameState.setProblemStatus('broken-light-pole-1', 'RESOLVED');
    this.updateProblemPresentation();
  }

  private syncRisks(): void {
    const state = this.risks.snapshot();
    this.onRisks?.(state);
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

  /** Limita a pegada inteira do frustum no chão, inclusive após resize e zoom. */
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
    const halfX = this.map.width / 2 - config.groundPadding;
    const halfZ = this.map.depth / 2 - config.groundPadding;
    const maxHeight = Math.min(2 * halfX / (maxX - minX), 2 * halfZ / (maxZ - minZ));
    const requestedHeight = (closeView ? config.closeHeight : config.wideHeight) * Math.max(1, config.portraitAspect / camera.aspect);
    const height = closeView ? Math.min(maxHeight, requestedHeight) : requestedHeight;
    const blend = snap ? 1 : 1 - Math.exp(-config.followSmoothing * Math.max(0, dt));
    this.cameraHeight = MathUtils.lerp(this.cameraHeight, height, blend);
    this.cameraTarget.lerp(this.player.mesh.position, blend);
    const h = this.cameraHeight;
    if (closeView) {
      this.cameraTarget.x = MathUtils.clamp(this.cameraTarget.x, -halfX - minX * h, halfX - maxX * h);
      this.cameraTarget.z = MathUtils.clamp(this.cameraTarget.z, -halfZ - minZ * h, halfZ - maxZ * h);
    }
    this.cameraTarget.y = 0;
    camera.position.set(this.cameraTarget.x, h, this.cameraTarget.z + h * config.tilt);
    camera.lookAt(this.cameraTarget);
    camera.updateMatrixWorld(true);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const axis = this.player.role === 'analista'
      ? this.idle : this.input.getAxis();
    if (dt > 0) this.items.face(suburbanGameState.activeCharacter, axis);
    this.traffic.update(dt);
    this.activeMobility.update(dt);
    this.updateProblemPresentation();
    for (const player of this.players) {
      const movementResolver = player.active && player.role === 'infraestrutura' ? this.resolveInfrastructureMovement : this.resolveMovement;
      player.update(dt, player.active ? axis : this.idle, movementResolver, player.active && this.input.isSprinting());
    }
  }

  private updateProblemPresentation(): void {
    const pole = suburbanGameState.snapshot().problems.find(problem => problem.id === 'broken-light-pole-1');
    const state = suburbanGameState.snapshot();
    if (pole) this.brokenPoleMarker.setState(pole.status, this.player.role === 'analista', state.selectedProblemId === pole.id);
    const team: ResponseTeam | null = this.player.role === 'infraestrutura' ? 'infraestrutura'
      : this.player.role === 'mobilidade' ? 'mobilidade' : null;
    const intervention = pole ? this.traffic.getActiveInterventionPosition(pole.position) : null;
    const objectiveVisible = !!pole && !!team && pole.dispatchedTeams.includes(team)
      && (pole.status !== 'RESOLVED' || (team === 'mobilidade' && intervention !== null));
    this.objectiveMarker.setVisible(objectiveVisible);
    if (objectiveVisible && pole) {
      const target = team === 'mobilidade'
        ? intervention ?? this.traffic.getNearestPrincipalLanePosition(pole.position) : pole.position;
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
    const dx = pole ? this.player.mesh.position.x - pole.position.x : Infinity;
    const dz = pole ? this.player.mesh.position.z - pole.position.z : Infinity;
    const nearPole = this.player.role === 'infraestrutura' && dx * dx + dz * dz <= 2.25;
    const workZone = pole ? this.traffic.getWorkZoneReadiness(pole.position) : null;
    this.traffic.setMobilityView(this.player.role === 'mobilidade');
    const prompt = road?.type === 'PRINCIPAL' ? nearCone ? 'REMOVER CONE' : 'COLOCAR CONE'
      : nearPole && pole?.status !== 'RESOLVED' && !pole?.dispatchedTeams.includes('infraestrutura') ? 'AGUARDE O ACIONAMENTO DA ANALISTA'
        : nearPole && pole?.status !== 'RESOLVED' && workZone?.prepared ? 'ÁREA PREPARADA · REPARAR POSTE'
        : nearPole && pole?.status !== 'RESOLVED' ? workZone?.reason === 'CARS_IN_WORK_ZONE' ? 'AGUARDE O TRECHO FICAR LIVRE'
          : workZone?.reason === 'WAITING_FOR_DIVERSION' ? 'AGUARDE O DESVIO DOS VEÍCULOS'
          : workZone?.reason === 'ACCESS_TOO_NARROW' ? 'ACESSO FÍSICO INSUFICIENTE'
            : 'ÁREA INSEGURA · PREPARE COM MOBILIDADE' : null;
    if (prompt !== this.currentInteractionPrompt) {
      this.currentInteractionPrompt = prompt;
      this.onInteractionPrompt?.(prompt);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.itemVisuals.dispose();
    this.activeMobility.dispose();
    this.traffic.dispose();
    this.brokenPoleMarker.dispose();
    this.objectiveMarker.dispose();
    this.players.forEach(player => player.dispose());
    this.mapView.dispose();
    this.sun.shadow.dispose();
    this.scene.clear();
    this.scene.background = null;
  }
}
