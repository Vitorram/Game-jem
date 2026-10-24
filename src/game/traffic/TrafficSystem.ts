import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, Shape, ShapeGeometry, TorusGeometry,
} from 'three';
import type { GridMap } from '../map/GridMap';
import { ROAD_LAYOUT } from '../map/roadLayout';
import { suburbanGameState, type RoadState } from '../core/GameState';
import { ORLA_CROSSING, ORLA_SCENERY_MARGIN } from '../config';
import { CROSSING_RULES, advanceWithRoom } from './crossingRules';
import { VehicleModels, VEHICLE_VISUAL_SCALE, type VehicleKind } from './VehicleModels';

export const FLEET_SEQUENCE: readonly VehicleKind[] = [
  'sedan', 'motorcycle', 'bus', 'truck', 'hatch', 'suv', 'pickup', 'motorcycle',
  'sedan', 'truck', 'hatch', 'motorcycle', 'suv', 'bus', 'pickup', 'sedan',
  'motorcycle', 'hatch', 'pickup', 'suv',
];
export const FLEET_COLORS = ['#e4a23b', '#48a9a2', '#d15e55', '#7f77bc', '#d8d5c8', '#4b6a84', '#5c9c6b', '#d97a43'] as const;

type Lane = {
  id: string;
  direction: 1 | -1;
  normalDirection: 1 | -1;
  z: number;
  type: RoadState['type'];
  capacity: number;
  priority: number;
  status: 'open' | 'blocked';
  arrows: Group;
  barriers: Group;
  coneGroup: Group;
};
type ConeObstacle = { lane: Lane; mesh: Mesh; x: number };
type Vehicle = {
  id: string;
  mesh: Group;
  lane: Lane;
  homeLane: Lane;
  preferredLane: Lane;
  kind: VehicleKind;
  speed: number;
  crossingCommitted: boolean;
  maxSpeed: number;
  laneChangeFromZ: number;
  laneChangeElapsed: number;
  chargeTargetIndex: number;
  chargeElapsed: number;
  charging: boolean;
  chargeRing: Group | null;
  lastProgressAt: number;
  stoppedSince: number | null;
  stopReason: TrafficStopReason;
  /** Guincho: participa do trânsito, mas só muda de faixa pela manobra de reboque. */
  tow?: boolean;
};
export type TrafficStopReason = 'none' | 'incident' | 'manual-stop' | 'lane-blocked' | 'crossing'
  | 'cone' | 'vehicle-ahead' | 'charging' | 'player';
export type TrafficDiagnostics = {
  elapsedSeconds: number;
  activeVehicles: number;
  movingVehicles: number;
  spawnedVehicles: number;
  exitedVehicles: number;
  stoppedVehicles: { id: string; laneId: string; reason: TrafficStopReason; stoppedForSeconds: number; lastProgressSecondsAgo: number }[];
  lanes: { id: string; status: Lane['status']; direction: 1 | -1; vehicles: number; moving: number }[];
  crossing: { phase: 'green' | 'yellow' | 'red'; waitingPedestrians: number; occupied: boolean; guarded: boolean; assisted: boolean };
  occurrences: string[];
  persistentInvalidBlocks: string[];
};
type ElectricCharger = { x: number; z: number; group: Group; statusLight: Mesh; statusMaterial: MeshStandardMaterial; broken: boolean };
export type TowTruckState = 'idle' | 'approaching' | 'loading' | 'departing' | 'completed';
export type MobilityRoadAction = 'release' | 'block' | 'blockAll' | 'reverse' | 'electricDetour';
export type WorkZoneReadiness = {
  prepared: boolean;
  reason: 'NEEDS_INTERVENTION' | 'WAITING_FOR_DIVERSION' | 'CARS_IN_WORK_ZONE' | 'ACCESS_TOO_NARROW' | null;
  nearbyVehicles: number;
};

const INITIAL_VEHICLES_PER_LANE = 1;
const MAX_VEHICLES_PER_LANE = 7;
const MAX_GREEN_VEHICLES = 6;
const VEHICLE_LENGTH = 1.35;
const VEHICLE_WIDTH = 0.56;
const SAFE_GAP = 4.2;
const MIN_BUMPER_GAP = 0.16;
const TRAFFIC_BRAKING = 4;
const CROSSING_CAR_CLEARANCE = CROSSING_RULES.roadConflictHalfWidth + VEHICLE_LENGTH / 2;
const LANE_CHANGE_DURATION = 0.7;
const LANE_CHANGE_LOOKAHEAD = 9;
const GREEN_LANE_CAPACITY = 30;
/** Raio do círculo de trabalho; compartilhado com o ActiveMobilitySystem. */
export const WORK_ZONE_CLEARANCE = 2.9;
const CONE_LOOKAHEAD = 9;
const CONE_STOP_DISTANCE = VEHICLE_LENGTH / 2 + 0.3;
const CROSSING_STOP_DISTANCE = 2.45;
const CROSSING_BRAKE_DISTANCE = 7;
/** Abaixo desta velocidade o carro da frente conta como parado para a regra de não bloquear a faixa. */
const KEEP_CLEAR_SPEED = 0.3;
/** Acima desta velocidade o carro atropela o personagem; abaixo dela é um obstáculo sólido. */
const PLAYER_COLLISION_SPEED = 0.05;
/** Quem chega a uma interdição para antes do ponto bloqueado, não onde estiver na pista. */
const BLOCK_STOP_DISTANCE = CROSSING_RULES.roadConflictHalfWidth + 0.15;
/** Durante o desvio, o elétrico reduz na faixa verde para abrir espaço e entrar na via comum. */
const DETOUR_MERGE_SPEED_FACTOR = 0.45;
const DETOUR_MERGE_AHEAD = 2.8;
const TOW_SPEED = 2.6;
/** O guincho entra fora da câmera, logo antes do trecho jogável. */
const TOW_ENTRY_OFFSET = 5;
/** Centro do guincho à frente do carro enguiçado: a plataforma traseira fica junto ao para-choque. */
const TOW_PICKUP_OFFSET = 2.2;
const TOW_MERGE_CLEARANCE = 2.4;
const TOW_BED_PIVOT_X = 0.2;
const TOW_BED_LENGTH = 1.15;
const TOW_BED_TILT = 0.24;
/** Posição local do carro já preso sobre a plataforma. */
const TOW_BED_X = -0.38;
const TOW_BED_Y = 0.33;
const TOW_LOAD_SECONDS = 3.2;
/** Raio do corpo do jogador usado para o atropelamento; menor que o de colisão do mapa. */

/** Fluxo viário da Orla: avenidas comuns e faixa verde exclusiva para elétricos. */
/**
 * `publishState: false` mantém o tráfego fora do suburbanGameState (o prólogo roda por cima
 * do jogo); `reservedLanes` não recebem veículos, para quem cria a cena coreografar a faixa.
 */
export type TrafficSystemOptions = { publishState?: boolean; reservedLanes?: readonly string[] };

export class TrafficSystem {
  readonly group = new Group();
  private readonly publishState: boolean;
  private readonly reservedLanes: ReadonlySet<string>;
  private readonly barrierGeometry = new BoxGeometry(0.15, 0.14, 0.84);
  private readonly coneGeometry = new ConeGeometry(0.22, 0.58, 8);
  private readonly barrierMaterial = new MeshStandardMaterial({ color: '#da584b', emissive: '#512018', roughness: 0.65 });
  private readonly towBeaconGeometry = new BoxGeometry(0.3, 0.1, 0.18);
  private readonly towBeaconMaterial = new MeshStandardMaterial({ color: '#ffb331', emissive: '#f07812', emissiveIntensity: 2.2 });
  private readonly towBedGeometry = new BoxGeometry(TOW_BED_LENGTH, 0.06, 0.62);
  private readonly towBoomGeometry = new BoxGeometry(0.09, 0.38, 0.09);
  private readonly towEquipmentMaterial = new MeshStandardMaterial({ color: '#536f75', roughness: 0.75 });
  private readonly chargerBodyMaterial = new MeshStandardMaterial({ color: '#e6f0e7', roughness: 0.55 });
  private readonly chargerScreenMaterial = new MeshStandardMaterial({ color: '#385b68', emissive: '#16353d', roughness: 0.4 });
  private readonly chargerCableMaterial = new MeshStandardMaterial({ color: '#27363b', roughness: 0.8 });
  private readonly chargerBaseGeometry = new BoxGeometry(0.62, 0.1, 0.16);
  private readonly chargerBodyGeometry = new BoxGeometry(0.28, 0.62, 0.17);
  private readonly chargerScreenGeometry = new BoxGeometry(0.17, 0.17, 0.025);
  private readonly chargerStatusGeometry = new CylinderGeometry(0.035, 0.035, 0.025, 10);
  private readonly chargerPlugGeometry = new BoxGeometry(0.055, 0.13, 0.07);
  private readonly chargerCableGeometry = new TorusGeometry(0.12, 0.018, 6, 12);
  private readonly chargeSegmentGeometry = new BoxGeometry(0.085, 0.025, 0.11);
  private readonly chargeSegmentOnMaterial = new MeshStandardMaterial({ color: '#75edaa', emissive: '#247247', emissiveIntensity: 1.1, roughness: 0.4 });
  private readonly chargeSegmentOffMaterial = new MeshStandardMaterial({ color: '#38504b', emissive: '#172721', roughness: 0.6 });
  private readonly directionGeometry: ShapeGeometry;
  private readonly directionMaterial = new MeshStandardMaterial({ color: '#d8e3dc', emissive: '#253a35', side: 2, roughness: 0.8 });
  private readonly greenDirectionMaterial = new MeshStandardMaterial({ color: '#8ee0b4', emissive: '#1d5038', side: 2, roughness: 0.8 });
  private readonly blockedDirectionMaterial = new MeshStandardMaterial({ color: '#ff7668', emissive: '#622016', side: 2, roughness: 0.8 });
  private readonly vehicles: Vehicle[] = [];
  private readonly cones: ConeObstacle[] = [];
  private readonly spawnTimers = new Map<string, number>();
  private readonly lanes: Lane[];
  private readonly chargers: ElectricCharger[];
  private readonly minX: number;
  private readonly width: number;
  /**
   * Trecho percorrido pelos veículos: a grade mais o cenário estendido dos dois lados.
   * Entram e saem além do que a câmera alcança, nunca surgindo ou sumindo na tela.
   */
  private readonly roadMinX: number;
  private readonly roadSpan: number;
  /** Limites por faixa escalados para o trecho longo: a densidade na tela continua a mesma. */
  private readonly maxVehiclesPerLane: number;
  private readonly maxGreenVehicles: number;
  private running = true;
  private electricDetour = false;
  private electricSpawnClock = 7;
  private electricSpawnIndex = 0;
  private mobilityView = false;
  private waitingPedestrians = 0;
  private pedestrianCrossingOccupied = false;
  private crossingSignalPhase: 'green' | 'yellow' | 'red' = 'green';
  private crossingSignalTimer = 0;
  private demandClock = 0;
  private demandLevel = 0.5;
  private scheduledDemand: number | null = null;
  private unsafeCrossing = false;
  private signalFailure = false;
  private guardedCrossing = false;
  private assistedCrossingRequested = false;
  private incidentVehicle: Vehicle | null = null;
  private collisionWarningVehicle: Vehicle | null = null;
  private towTruck: Vehicle | null = null;
  private towTruckState: TowTruckState = 'idle';
  private towTruckTimer = 0;
  /** Distância local (no sentido do guincho) de onde o carro começa a ser puxado. */
  private towLoadFromX = 0;
  private readonly incidentLights = new Group();
  private incidentTime = 0;
  private trafficRandomSeed = 173;
  private readonly pedestrianCrossingX = ORLA_CROSSING.centerX;
  /** Posição do personagem a pé, usada para frear e para detectar atropelamento. */
  private playerPosition: { x: number; z: number } | null = null;
  /** Ponto em que a pista foi interditada; quem já passou dele não precisa parar. */
  private blockAnchorX: number | null = null;
  private readonly vehicleModels = new VehicleModels();
  private spawnedCount = 0;
  private vehicleIdSequence = 0;
  private createdVehicleCount = 0;
  private exitedVehicleCount = 0;
  private elapsedSeconds = 0;
  private disposed = false;
  private roadStatePublishElapsed = 0;

  constructor(map: GridMap, { publishState = true, reservedLanes = [] }: TrafficSystemOptions = {}) {
    this.publishState = publishState;
    this.reservedLanes = new Set(reservedLanes);
    this.group.name = 'traffic-flow';
    this.width = map.width;
    this.minX = -map.width / 2;
    this.roadMinX = this.minX - ORLA_SCENERY_MARGIN - VEHICLE_LENGTH;
    this.roadSpan = this.width + 2 * (ORLA_SCENERY_MARGIN + VEHICLE_LENGTH);
    this.maxVehiclesPerLane = Math.ceil(MAX_VEHICLES_PER_LANE * this.roadSpan / this.width);
    this.maxGreenVehicles = Math.ceil(MAX_GREEN_VEHICLES * this.roadSpan / this.width);
    const arrowShape = new Shape();
    arrowShape.moveTo(-0.38, -0.16); arrowShape.lineTo(0.05, -0.16); arrowShape.lineTo(0.05, -0.3);
    arrowShape.lineTo(0.42, 0); arrowShape.lineTo(0.05, 0.3); arrowShape.lineTo(0.05, 0.16); arrowShape.lineTo(-0.38, 0.16); arrowShape.closePath();
    this.directionGeometry = new ShapeGeometry(arrowShape);
    const roadLowEdge = map.depth / 2 - map.tileSize * 3;
    const greenRoadZ = roadLowEdge + ROAD_LAYOUT.greenCenter;
    this.lanes = [
      this.createLane('orla-eastbound', 1, roadLowEdge + ROAD_LAYOUT.eastbound[0], 'PRINCIPAL', 100, 1),
      this.createLane('orla-eastbound-2', 1, roadLowEdge + ROAD_LAYOUT.eastbound[1], 'PRINCIPAL', 100, 1),
      this.createLane('orla-westbound', -1, roadLowEdge + ROAD_LAYOUT.westbound[0], 'PRINCIPAL', 100, 1),
      this.createLane('orla-westbound-2', -1, roadLowEdge + ROAD_LAYOUT.westbound[1], 'PRINCIPAL', 100, 1),
      this.createLane('orla-green', 1, greenRoadZ, 'GREEN', GREEN_LANE_CAPACITY, 0),
    ];
    this.chargers = this.createChargers(greenRoadZ);
    this.lanes.forEach((lane, laneIndex) => {
      if (lane.type === 'GREEN' || this.reservedLanes.has(lane.id)) return;
      this.spawnTimers.set(lane.id, 1.4 + laneIndex * 0.65);
      for (let index = 0; index < INITIAL_VEHICLES_PER_LANE; index++) {
        const vehicleIndex = laneIndex * INITIAL_VEHICLES_PER_LANE + index;
        const mesh = this.makeVehicle();
        const startFraction = [0.2, 0.42, 0.63, 0.83][laneIndex % 4];
        const start = this.minX + this.width * startFraction;
        mesh.position.set(start, 0.27, lane.z);
        mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
        this.group.add(mesh);
        const maxSpeed = 1.6 + ((vehicleIndex + laneIndex) % 3) * 0.35;
        this.vehicles.push({ id: this.nextVehicleId(), mesh, lane, homeLane: lane, preferredLane: lane, kind: mesh.userData.vehicleKind as VehicleKind,
          speed: maxSpeed, crossingCommitted: false, maxSpeed, laneChangeFromZ: lane.z, laneChangeElapsed: LANE_CHANGE_DURATION,
          chargeTargetIndex: 0, chargeElapsed: 0, charging: false, chargeRing: null,
          lastProgressAt: 0, stoppedSince: null, stopReason: 'none' });
        this.createdVehicleCount++;
      }
    });
    const greenLane = this.lanes.find(lane => lane.type === 'GREEN')!;
    this.spawnElectricVehicle(greenLane, this.minX + 4, 0);
    this.spawnElectricVehicle(greenLane, this.minX + 13, 1);
    this.electricSpawnIndex = 2;
    this.setMobilityView(false);
    this.publishRoadState(true);
  }

  private createLane(id: string, direction: 1 | -1, z: number, type: Lane['type'], capacity: number, priority: number, initialStatus: Lane['status'] = 'open'): Lane {
    const arrows = new Group();
    arrows.name = `direction-markers-${id}`;
    const count = type === 'GREEN' ? 6 : 8;
    const spacing = this.width / count;
    const extra = Math.floor(ORLA_SCENERY_MARGIN / spacing);
    for (let i = -extra; i < count + extra; i++) {
      const arrowX = this.minX + spacing * (i + 0.5);
      if (Math.abs(arrowX - this.pedestrianCrossingX) < 2.15) continue;
      const marker = new Mesh(this.directionGeometry, type === 'GREEN' ? this.greenDirectionMaterial : this.directionMaterial);
      marker.rotation.x = -Math.PI / 2;
      marker.rotation.z = direction === 1 ? 0 : Math.PI;
      marker.position.set(arrowX, 0.055, z);
      arrows.add(marker);
    }
    this.group.add(arrows);
    const barriers = new Group();
    if (type === 'GREEN' && initialStatus === 'blocked') {
      for (const x of [this.minX + 0.8, -this.minX - 0.8]) {
        const barrier = new Mesh(this.barrierGeometry, this.barrierMaterial);
        barrier.position.set(x, 0.1, z);
        barriers.add(barrier);
      }
      this.group.add(barriers);
    }
    const coneGroup = new Group();
    coneGroup.name = `cones-${id}`;
    this.group.add(coneGroup);
    const lane: Lane = { id, direction, normalDirection: direction, z, type, capacity, priority, status: initialStatus, arrows, barriers, coneGroup };
    if (type === 'GREEN') {
      arrows.children.forEach(marker => { (marker as Mesh).position.y = 0.055; });
    }
    this.syncLaneVisual(lane);
    return lane;
  }

  private createChargers(greenLaneZ: number): ElectricCharger[] {
    const xPositions = [this.minX + 8, this.minX + this.width * 0.44, this.minX + this.width - 8];
    return xPositions.map((x, index) => {
      // Posições junto ao bordo sul da faixa verde, no intervalo antes da pista comum.
      const z = greenLaneZ + ROAD_LAYOUT.chargerOffset;
      const group = new Group();
      group.name = `electric-charger-${index + 1}`;
      group.position.set(x, 0, z);
      const base = new Mesh(this.chargerBaseGeometry, this.chargerCableMaterial);
      base.position.y = 0.07;
      const body = new Mesh(this.chargerBodyGeometry, this.chargerBodyMaterial);
      body.position.set(0, 0.4, 0);
      const screen = new Mesh(this.chargerScreenGeometry, this.chargerScreenMaterial);
      screen.position.set(0, 0.52, 0.1);
      const statusMaterial = new MeshStandardMaterial({ color: '#7ee6a5', emissive: '#246b42', emissiveIntensity: 1.1 });
      const statusLight = new Mesh(this.chargerStatusGeometry, statusMaterial);
      statusLight.rotation.x = Math.PI / 2;
      statusLight.position.set(0, 0.68, 0.1);
      const cable = new Mesh(this.chargerCableGeometry, this.chargerCableMaterial);
      cable.rotation.x = Math.PI / 2;
      cable.position.set(0.19, 0.28, 0.04);
      const plug = new Mesh(this.chargerPlugGeometry, this.chargerScreenMaterial);
      plug.position.set(0.2, 0.19, 0.1);
      for (const mesh of [base, body, screen, statusLight, cable, plug]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      this.group.add(group);
      return { x, z, group, statusLight, statusMaterial, broken: false };
    });
  }

  getElectricChargerPosition(): { x: number; z: number } {
    const charger = this.chargers[Math.floor(this.chargers.length / 2)];
    return { x: charger.x, z: charger.z };
  }

  setElectricChargerBroken(broken: boolean): void {
    const charger = this.chargers[Math.floor(this.chargers.length / 2)];
    charger.broken = broken;
    charger.statusMaterial.color.set(broken ? '#ff665b' : '#7ee6a5');
    charger.statusMaterial.emissive.set(broken ? '#7a201a' : '#246b42');
    charger.statusMaterial.emissiveIntensity = broken ? 1.8 : 1.1;
    this.electricDetour = false;
    this.publishRoadState(true);
  }

  isElectricChargerBroken(): boolean {
    return this.chargers[Math.floor(this.chargers.length / 2)].broken;
  }

  getElectricQueueCount(): number {
    const chargerIndex = Math.floor(this.chargers.length / 2);
    const charger = this.chargers[chargerIndex];
    return this.vehicles.filter(vehicle => this.isElectricVehicle(vehicle.kind)
      && vehicle.lane.type === 'GREEN' && vehicle.chargeTargetIndex === chargerIndex
      && vehicle.mesh.position.x >= charger.x - 5 && vehicle.speed < 0.25).length;
  }

  setElectricDiversion(enabled: boolean): void {
    this.electricDetour = enabled;
    this.publishRoadState(true);
  }

  isElectricDiversionActive(): boolean { return this.electricDetour; }

  private syncLaneVisual(lane: Lane): void {
    lane.barriers.visible = lane.status === 'blocked';
    lane.arrows.visible = this.mobilityView;
    lane.arrows.children.forEach(marker => {
      const mesh = marker as Mesh;
      mesh.rotation.z = lane.direction === 1 ? 0 : Math.PI;
      if (lane.status === 'blocked') mesh.material = this.blockedDirectionMaterial;
      else if (lane.type === 'GREEN') mesh.material = this.greenDirectionMaterial;
      else mesh.material = this.directionMaterial;
    });
  }

  setMobilityView(visible: boolean): void {
    this.mobilityView = visible;
    this.lanes.forEach(lane => this.syncLaneVisual(lane));
  }

  /** Posição do personagem a pé (null quando a Analista está ativa). */
  setPlayerPosition(position: { x: number; z: number } | null): void {
    this.playerPosition = position ? { x: position.x, z: position.z } : null;
  }

  setScheduledDemand(level: number): void { this.scheduledDemand = MathUtils.clamp(level, 0, 1); }

  setUnsafeCrossing(unsafe: boolean): void { this.unsafeCrossing = unsafe; }
  setSignalFailure(active: boolean): void { this.signalFailure = active; }
  setCrossingGuarded(guarded: boolean): void { this.guardedCrossing = guarded; }
  setAssistedCrossingRequested(requested: boolean): void { this.assistedCrossingRequested = requested; }
  isCrossingGuarded(): boolean { return this.guardedCrossing; }
  isCrossingStopActive(): boolean {
    return !this.running || this.signalFailure || this.guardedCrossing || this.assistedCrossingRequested
      || this.pedestrianCrossingOccupied || (!this.unsafeCrossing && this.waitingPedestrians > 0);
  }

  getQueuedVehicleCount(): number {
    return this.vehicles.filter(vehicle => vehicle !== this.incidentVehicle && vehicle.speed < 0.25 && this.isOnMap(vehicle)).length;
  }

  getMovingVehicleCount(): number { return this.vehicles.filter(vehicle => vehicle.speed > 0.4).length; }

  getIncidentPosition(): { x: number; z: number } | null {
    const position = this.incidentVehicle?.mesh.position;
    return position ? { x: position.x, z: position.z } : null;
  }

  warnCollision(): void {
    if (this.incidentVehicle || this.collisionWarningVehicle) return;
    const lane = this.lanes.find(candidate => candidate.id === 'orla-eastbound-2')!;
    let vehicle = this.vehicles.filter(candidate => candidate.lane === lane
      && candidate.mesh.position.x >= this.minX + 5 && candidate.mesh.position.x <= this.minX + this.width - 8)
      .sort((a, b) => Math.abs(a.mesh.position.x - 10) - Math.abs(b.mesh.position.x - 10))[0];
    if (!vehicle) {
      for (const x of [10, 2, -6, -12]) {
        if (this.trySpawnVehicle(lane, x)) { vehicle = this.vehicles[this.vehicles.length - 1]; break; }
      }
    }
    if (!vehicle) return;
    this.collisionWarningVehicle = vehicle;
    vehicle.laneChangeElapsed = LANE_CHANGE_DURATION;
    vehicle.mesh.position.z = lane.z;
    for (const x of [-0.8, 0.8]) {
      const light = new Mesh(this.barrierGeometry, this.barrierMaterial);
      light.position.set(x, 0.55, 0);
      light.scale.set(0.4, 1.5, 0.6);
      this.incidentLights.add(light);
    }
    vehicle.mesh.add(this.incidentLights);
  }

  startCollision(): void {
    if (this.incidentVehicle) return;
    this.warnCollision();
    const vehicle = this.collisionWarningVehicle;
    if (!vehicle) return;
    this.incidentVehicle = vehicle;
    this.collisionWarningVehicle = null;
    vehicle.speed = 0;
    vehicle.stoppedSince = this.elapsedSeconds;
    vehicle.stopReason = 'incident';
  }

  /** Enguiça um carro numa faixa real para que a fila se forme atrás dele. */
  startBreakdown(): { x: number; z: number } | null {
    this.warnCollision();
    if (!this.collisionWarningVehicle && !this.incidentVehicle) {
      const lane = this.lanes.find(candidate => candidate.id === 'orla-eastbound-2');
      if (lane) {
        const mesh = this.makeVehicle('sedan', '#d15e55');
        mesh.position.set(10, 0.27, lane.z);
        mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
        this.group.add(mesh);
        const maxSpeed = 1.8;
        this.collisionWarningVehicle = { id: this.nextVehicleId(), mesh, lane, homeLane: lane, preferredLane: lane, kind: 'sedan',
          speed: maxSpeed, crossingCommitted: false, maxSpeed, laneChangeFromZ: lane.z, laneChangeElapsed: LANE_CHANGE_DURATION,
          chargeTargetIndex: 0, chargeElapsed: 0, charging: false, chargeRing: null,
          lastProgressAt: this.elapsedSeconds, stoppedSince: null, stopReason: 'none' };
        this.vehicles.push(this.collisionWarningVehicle);
        this.createdVehicleCount++;
        for (const x of [-0.8, 0.8]) {
          const light = new Mesh(this.barrierGeometry, this.barrierMaterial);
          light.position.set(x, 0.55, 0);
          light.scale.set(0.4, 1.5, 0.6);
          this.incidentLights.add(light);
        }
        mesh.add(this.incidentLights);
      }
    }
    this.startCollision();
    return this.getIncidentPosition();
  }

  /**
   * O guincho vem pela faixa vizinha, ultrapassa o carro enguiçado, entra na faixa
   * dele logo à frente e puxa o carro para a plataforma antes de sair da avenida.
   */
  callTowTruck(): boolean {
    const incident = this.incidentVehicle;
    if (!incident || (this.towTruckState !== 'idle' && this.towTruckState !== 'completed')) return false;
    if (!this.getTowApproachLane(incident.lane)) return false;
    this.towTruck = null;
    this.towTruckState = 'approaching';
    this.towTruckTimer = 0;
    this.trySpawnTowTruck();
    return true;
  }

  getTowTruckState(): TowTruckState { return this.towTruckState; }

  clearBreakdown(): void {
    // Já carregado, o guincho segue como trânsito comum até sair; antes disso não há o que rebocar.
    if (this.towTruck && (this.towTruckState === 'approaching' || this.towTruckState === 'loading')) this.removeVehicle(this.towTruck);
    this.towTruck = null;
    this.towTruckState = 'idle';
    this.clearCollision();
  }

  private getTowApproachLane(incidentLane: Lane): Lane | null {
    return this.lanes.filter(lane => lane.type === 'PRINCIPAL' && lane !== incidentLane && lane.direction === incidentLane.direction)
      .sort((a, b) => Math.abs(a.z - incidentLane.z) - Math.abs(b.z - incidentLane.z))[0] ?? null;
  }

  private getTowPickupX(incident: Vehicle): number {
    return incident.mesh.position.x + incident.lane.direction * TOW_PICKUP_OFFSET;
  }

  private trySpawnTowTruck(): void {
    const incident = this.incidentVehicle;
    const lane = incident && this.getTowApproachLane(incident.lane);
    if (!lane) return;
    // Com fila na entrada, o guincho surge no primeiro vão livre mais atrás, ainda fora da câmera.
    const preferredX = lane.direction === 1 ? this.minX - TOW_ENTRY_OFFSET : this.minX + this.width + TOW_ENTRY_OFFSET;
    const roadEntryX = lane.direction === 1 ? this.roadMinX : this.roadMinX + this.roadSpan;
    let entryX: number | null = null;
    for (let x = preferredX; (x - roadEntryX) * lane.direction >= 0; x -= lane.direction) {
      if (this.vehicles.every(vehicle => Math.abs(vehicle.mesh.position.z - lane.z) >= 0.72
        || Math.abs(vehicle.mesh.position.x - x) >= SAFE_GAP)) { entryX = x; break; }
    }
    if (entryX === null) return;
    const mesh = this.makeTowTruck();
    mesh.position.set(entryX, 0.27, lane.z);
    mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
    this.group.add(mesh);
    this.towTruck = { id: this.nextVehicleId(), mesh, lane, homeLane: lane, preferredLane: lane, kind: 'truck',
      speed: TOW_SPEED * 0.8, crossingCommitted: false, maxSpeed: TOW_SPEED, laneChangeFromZ: lane.z,
      laneChangeElapsed: LANE_CHANGE_DURATION, chargeTargetIndex: 0, chargeElapsed: 0, charging: false, chargeRing: null,
      lastProgressAt: this.elapsedSeconds, stoppedSince: null, stopReason: 'none', tow: true };
    this.vehicles.push(this.towTruck);
    this.createdVehicleCount++;
  }

  /** Caminhão sem o baú de carga, com plataforma basculante presa a um pivô na frente. */
  private makeTowTruck(): Group {
    const mesh = this.makeVehicle('truck', '#e5a739');
    mesh.name = 'orla-tow-truck';
    for (const name of ['cargo-box', 'cargo-stripe']) {
      const part = mesh.getObjectByName(name);
      if (part) part.visible = false;
    }
    const pivot = new Group();
    pivot.name = 'tow-bed-pivot';
    pivot.position.set(TOW_BED_PIVOT_X, 0, 0);
    const bed = new Mesh(this.towBedGeometry, this.towEquipmentMaterial);
    bed.name = 'tow-flatbed';
    bed.position.set(-TOW_BED_LENGTH / 2, 0.03, 0);
    bed.castShadow = true;
    bed.receiveShadow = true;
    pivot.add(bed);
    mesh.add(pivot);
    const boom = new Mesh(this.towBoomGeometry, this.towBeaconMaterial);
    boom.name = 'tow-boom';
    boom.position.set(TOW_BED_PIVOT_X + 0.04, 0.22, 0);
    mesh.add(boom);
    const beacon = new Mesh(this.towBeaconGeometry, this.towBeaconMaterial);
    beacon.name = 'tow-beacon';
    beacon.position.set(0.55, 0.55, 0);
    mesh.add(beacon);
    return mesh;
  }

  /** Espaço para o guincho entrar na faixa do carro enguiçado sem encostar em ninguém. */
  private towMergeIsClear(lane: Lane, truck: Vehicle): boolean {
    return this.vehicles.every(other => other === truck || other === this.incidentVehicle
      || (other.lane !== lane && Math.abs(other.mesh.position.z - lane.z) >= 0.72)
      || Math.abs(other.mesh.position.x - truck.mesh.position.x) >= TOW_MERGE_CLEARANCE);
  }

  private updateTowTruck(dt: number): void {
    if (this.towTruckState === 'approaching' && !this.towTruck) this.trySpawnTowTruck();
    const truck = this.towTruck;
    if (!truck) return;
    const beacon = truck.mesh.getObjectByName('tow-beacon');
    if (beacon) beacon.visible = Math.floor(this.incidentTime * 5) % 2 === 0;
    const incident = this.incidentVehicle;
    if (this.towTruckState === 'approaching') {
      if (!incident) { this.towTruckState = 'departing'; return; }
      const distance = (this.getTowPickupX(incident) - truck.mesh.position.x) * truck.lane.direction;
      const stopped = truck.speed <= CROSSING_RULES.stoppedSpeed;
      if (truck.lane !== incident.lane) {
        if (stopped && distance <= 0.05 && this.towMergeIsClear(incident.lane, truck)) this.startLaneTransition(truck, incident.lane);
      } else if (stopped && truck.laneChangeElapsed >= LANE_CHANGE_DURATION) {
        this.towTruckState = 'loading';
        this.towTruckTimer = 0;
        this.towLoadFromX = (incident.mesh.position.x - truck.mesh.position.x) * truck.lane.direction;
        incident.mesh.remove(this.incidentLights);
        this.incidentLights.clear();
      }
      return;
    }
    if (this.towTruckState === 'loading') {
      this.updateTowLoading(dt, truck);
      return;
    }
    if (this.towTruckState === 'departing') {
      const x = truck.mesh.position.x;
      if (truck.lane.direction === 1 ? x > this.minX + this.width + 1 : x < this.minX - 1) this.towTruckState = 'completed';
    }
  }

  /** Até onde o guincho pode avançar: para ao lado do ponto de embarque e espera durante o carregamento. */
  private getTowRoom(truck: Vehicle): number {
    const incident = this.incidentVehicle;
    if (this.towTruckState === 'loading') return 0;
    if (this.towTruckState !== 'approaching' || !incident) return Infinity;
    if (truck.lane === incident.lane) return 0;
    return Math.max(0, (this.getTowPickupX(incident) - truck.mesh.position.x) * truck.lane.direction);
  }

  /** Inclina a plataforma, puxa o carro rampa acima, nivela e prende o carro ao guincho. */
  private updateTowLoading(dt: number, truck: Vehicle): void {
    this.towTruckTimer += dt;
    const time = this.towTruckTimer;
    const smooth = (value: number) => { const t = MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
    const tilt = TOW_BED_TILT * (smooth(time / 0.6) - smooth((time - (TOW_LOAD_SECONDS - 0.6)) / 0.6));
    const pivot = truck.mesh.getObjectByName('tow-bed-pivot');
    if (pivot) pivot.rotation.z = tilt;
    const car = this.incidentVehicle;
    if (!car) { if (time >= TOW_LOAD_SECONDS) this.towTruckState = 'departing'; return; }
    const pull = smooth((time - 0.6) / (TOW_LOAD_SECONDS - 1.2));
    const localX = MathUtils.lerp(this.towLoadFromX, TOW_BED_X, pull);
    // Altura da superfície da plataforma sob o centro do carro; antes da rampa, o carro segue no chão.
    const height = Math.max(0, TOW_BED_Y - (TOW_BED_PIVOT_X - localX) * Math.sin(tilt));
    const direction = truck.lane.direction;
    car.mesh.position.set(truck.mesh.position.x + direction * localX, 0.27 + height, truck.mesh.position.z);
    car.mesh.rotation.z = tilt * MathUtils.clamp(height / 0.08, 0, 1);
    if (time < TOW_LOAD_SECONDS) return;
    const index = this.vehicles.indexOf(car);
    if (index >= 0) this.vehicles.splice(index, 1);
    this.incidentVehicle = null;
    if (this.collisionWarningVehicle === car) this.collisionWarningVehicle = null;
    truck.mesh.add(car.mesh);
    car.mesh.position.set(TOW_BED_X, TOW_BED_Y, 0);
    car.mesh.rotation.set(0, 0, 0);
    if (pivot) pivot.rotation.z = 0;
    this.towTruckState = 'departing';
  }

  clearCollision(): void {
    if (!this.incidentVehicle) return;
    this.incidentVehicle.mesh.remove(this.incidentLights);
    this.incidentLights.clear();
    this.removeVehicle(this.incidentVehicle);
    this.incidentVehicle = null;
  }

  isIncidentProtected(): boolean {
    const vehicle = this.incidentVehicle;
    if (!vehicle) return false;
    const cone = this.cones.some(item => item.lane === vehicle.lane
      && (vehicle.mesh.position.x - item.x) * vehicle.lane.direction >= 1.5
      && (vehicle.mesh.position.x - item.x) * vehicle.lane.direction <= 5);
    return cone && vehicle.lane.status === 'blocked';
  }

  getIncidentConeTarget(): { x: number; z: number } | null {
    const vehicle = this.incidentVehicle;
    return vehicle ? { x: MathUtils.clamp(vehicle.mesh.position.x - vehicle.lane.direction * 3, this.minX + 1, this.minX + this.width - 1), z: vehicle.lane.z } : null;
  }

  getNearestConePosition(position: { x: number; z: number }): { x: number; z: number } | null {
    const cone = [...this.cones].sort((a, b) => Math.hypot(a.x - position.x, a.lane.z - position.z)
      - Math.hypot(b.x - position.x, b.lane.z - position.z))[0];
    return cone ? { x: cone.x, z: cone.lane.z } : null;
  }

  resetRoadInterventions(): void {
    this.blockAnchorX = null;
    for (const cone of [...this.cones]) this.removeCone(cone);
    this.lanes.forEach(lane => {
      lane.status = 'open';
      lane.direction = lane.normalDirection;
      this.syncLaneVisual(lane);
    });
    this.vehicles.forEach(vehicle => {
      vehicle.laneChangeFromZ = vehicle.lane.z;
      vehicle.laneChangeElapsed = LANE_CHANGE_DURATION;
      vehicle.mesh.position.z = vehicle.lane.z;
      vehicle.mesh.rotation.y = vehicle.lane.direction === 1 ? 0 : Math.PI;
    });
    this.electricDetour = false;
    this.running = true;
    this.publishRoadState(true);
  }

  getPlayerCollision(position: { x: number; z: number }, radius = 0.34): { x: number; z: number } | null {
    const impact = this.vehicles
      .filter(vehicle => vehicle.speed > PLAYER_COLLISION_SPEED
        && Math.abs(vehicle.mesh.position.x - position.x) <= VEHICLE_LENGTH / 2 + radius
        && Math.abs(vehicle.mesh.position.z - position.z) <= VEHICLE_WIDTH / 2 + radius)
      .sort((a, b) => Math.hypot(a.mesh.position.x - position.x, a.mesh.position.z - position.z)
        - Math.hypot(b.mesh.position.x - position.x, b.mesh.position.z - position.z))[0];
    if (!impact) return null;
    const dz = position.z - impact.mesh.position.z;
    const push = { x: impact.lane.direction * 0.8, z: dz >= 0 ? 1 : -1 };
    const length = Math.hypot(push.x, push.z) || 1;
    return { x: push.x / length, z: push.z / length };
  }

  getNearbyLane(x: number, z: number): string | null {
    if (x < this.minX || x > this.minX + this.width) return null;
    const lane = this.lanes.reduce((nearest, candidate) => Math.abs(candidate.z - z) < Math.abs(nearest.z - z) ? candidate : nearest);
    return Math.abs(z - lane.z) <= 1.2 ? lane.id : null;
  }

  /** Ponto na calçada norte, junto ao meio-fio, fora de qualquer faixa de rolamento. */
  getRoadsidePosition(x: number): { x: number; z: number } {
    const northEdge = Math.min(...this.lanes.map(lane => lane.z)) - ROAD_LAYOUT.greenCenter;
    return { x: MathUtils.clamp(x, this.minX + 0.8, this.minX + this.width - 0.8), z: northEdge - 0.5 };
  }

  getNearestPrincipalLanePosition(position: { x: number; z: number }): { x: number; z: number } {
    const lane = this.lanes.filter(candidate => candidate.type === 'PRINCIPAL')
      .reduce((nearest, candidate) => Math.abs(candidate.z - position.z) < Math.abs(nearest.z - position.z) ? candidate : nearest);
    return { x: MathUtils.clamp(position.x, this.minX + 0.8, this.minX + this.width - 0.8), z: lane.z };
  }

  /** Ponto da via em que a Mobilidade deve largar o cone para proteger o poste. */
  getWorkZoneApproachPosition(polePosition: { x: number; z: number }): { x: number; z: number } {
    const lane = this.lanes.filter(candidate => candidate.type === 'PRINCIPAL')
      .reduce((nearest, candidate) => Math.abs(candidate.z - polePosition.z) < Math.abs(nearest.z - polePosition.z) ? candidate : nearest);
    // O cone fica alguns metros antes do poste, no sentido de quem chega.
    const x = polePosition.x - lane.direction * 1.6;
    return { x: MathUtils.clamp(x, this.minX + 1, this.minX + this.width - 1), z: lane.z };
  }

  getNearbyCone(x: number, z: number, radius = 1.8): boolean {
    return this.cones.some(cone => Math.hypot(cone.x - x, cone.lane.z - z) <= radius);
  }

  placeConeAt(roadId: string, x: number): boolean {
    const lane = this.lanes.find(candidate => candidate.id === roadId && candidate.type === 'PRINCIPAL');
    if (!lane || this.cones.length >= 18) return false;
    const coneX = MathUtils.clamp(x, this.minX + 1, this.minX + this.width - 1);
    if (this.cones.some(cone => cone.lane === lane && Math.abs(cone.x - coneX) < 1.5)) return false;
    const cone = new Mesh(this.coneGeometry, this.barrierMaterial);
    cone.position.set(coneX, 0.31, lane.z);
    cone.castShadow = true;
    lane.coneGroup.add(cone);
    this.cones.push({ lane, mesh: cone, x: coneX });
    this.publishRoadState(true);
    return true;
  }

  removeNearestCone(x: number, z: number, radius = 1.8): boolean {
    const nearest = this.cones.map(cone => ({ cone, distance: Math.hypot(cone.x - x, cone.lane.z - z) }))
      .filter(candidate => candidate.distance <= radius).sort((a, b) => a.distance - b.distance)[0]?.cone;
    if (!nearest) return false;
    this.removeCone(nearest);
    this.publishRoadState(true);
    return true;
  }

  getActiveInterventionPosition(reference: { x: number; z: number }): { x: number; z: number } | null {
    const affected = this.lanes.filter(lane => lane.type === 'PRINCIPAL'
      && (lane.status === 'blocked' || this.cones.some(cone => cone.lane === lane) || lane.direction !== lane.normalDirection));
    const lane = affected.sort((a, b) => Math.abs(a.z - reference.z) - Math.abs(b.z - reference.z))[0];
    if (!lane) return null;
    const cone = this.cones.filter(item => item.lane === lane)
      .sort((a, b) => Math.abs(a.x - reference.x) - Math.abs(b.x - reference.x))[0];
    const x = cone?.x ?? reference.x;
    return { x: MathUtils.clamp(x, this.minX + 0.8, this.minX + this.width - 0.8), z: lane.z };
  }

  getRoadStates(): RoadState[] {
    return this.lanes.map(lane => {
      const vehicles = this.vehicles.filter(vehicle => vehicle.lane === lane && this.isOnMap(vehicle));
      const congestion = this.getLaneCongestion(lane);
      return {
        id: lane.id,
        direction: lane.direction === lane.normalDirection ? 'NORMAL' : 'REVERSE',
        status: lane.status === 'blocked' ? 'blocked'
          : !this.running && vehicles.every(vehicle => vehicle.speed <= CROSSING_RULES.stoppedSpeed) ? 'stopped' : 'open',
        type: lane.type,
        capacity: this.getEffectiveLaneCapacity(lane),
        priority: lane.priority,
        redirected: lane.type === 'GREEN' ? this.electricDetour
          : this.vehicles.some(vehicle => this.isElectricVehicle(vehicle.kind) && vehicle.lane === lane && vehicle.homeLane.type === 'GREEN'),
        vehicleCount: vehicles.length,
        congestion: lane.status === 'blocked' && vehicles.length ? 1 : congestion,
        conesActive: this.cones.some(cone => cone.lane === lane),
        coneZoneId: null,
      };
    });
  }

  /**
   * `cyclistsInZone` vem do ActiveMobilitySystem: ciclistas dentro do círculo de
   * trabalho também impedem o reparo, não só os carros.
   */
  getWorkZoneReadiness(position: { x: number; z: number }, cyclistsInZone = 0): WorkZoneReadiness {
    const principalLanes = this.lanes.filter(lane => lane.type === 'PRINCIPAL');
    const workLane = principalLanes.reduce((nearest, lane) => Math.abs(lane.z - position.z) < Math.abs(nearest.z - position.z) ? lane : nearest);
    const approachSpace = Math.abs(workLane.z - position.z) - VEHICLE_WIDTH / 2;
    const workCones = this.cones.filter(cone => cone.lane === workLane && Math.abs(cone.x - position.x) <= 3.2);
    const coneIntervention = workCones.length > 0;
    const blockIntervention = workLane.status === 'blocked';
    const nearbyVehicles = this.vehicles.filter(vehicle =>
      Math.hypot(vehicle.mesh.position.x - position.x, vehicle.mesh.position.z - position.z) <= WORK_ZONE_CLEARANCE).length
      + Math.max(0, cyclistsInZone);
    const vehiclesRespectingCones = !coneIntervention || !this.vehicles.some(vehicle => workCones.some(cone =>
      Math.abs(vehicle.mesh.position.x - cone.x) < VEHICLE_LENGTH && Math.abs(vehicle.mesh.position.z - cone.lane.z) < 0.72));
    const spaceAvailable = approachSpace >= 0.9;
    const intervened = coneIntervention || blockIntervention;
    const prepared = intervened && vehiclesRespectingCones && nearbyVehicles === 0 && spaceAvailable;
    const reason: WorkZoneReadiness['reason'] = prepared ? null
      : !spaceAvailable ? 'ACCESS_TOO_NARROW'
        : !intervened ? 'NEEDS_INTERVENTION'
          : 'CARS_IN_WORK_ZONE';
    return { prepared, reason, nearbyVehicles };
  }

  /**
   * Impede o personagem de entrar em carros. Com `onlyStopped`, só os parados
   * (recarga, acidente, fila) são sólidos: os em movimento atropelam e reiniciam o personagem.
   */
  resolveWorkerMovement(from: { x: number; z: number }, to: { x: number; z: number }, radius: number, onlyStopped = false): { x: number; z: number } {
    const resolved = { ...to };
    for (const vehicle of this.vehicles) {
      if (onlyStopped && vehicle.speed > PLAYER_COLLISION_SPEED) continue;
      const halfLength = VEHICLE_LENGTH / 2 + radius;
      const halfWidth = 0.36 + radius;
      const left = vehicle.mesh.position.x - halfLength;
      const right = vehicle.mesh.position.x + halfLength;
      const near = vehicle.mesh.position.z - halfWidth;
      const far = vehicle.mesh.position.z + halfWidth;
      if (resolved.x < left || resolved.x > right || resolved.z < near || resolved.z > far) continue;

      const startedOutsideX = from.x < left || from.x > right;
      const startedOutsideZ = from.z < near || from.z > far;
      if (startedOutsideX) resolved.x = from.x;
      if (startedOutsideZ) resolved.z = from.z;
      if (!startedOutsideX && !startedOutsideZ) {
        const pushes = [
          { distance: Math.abs(resolved.x - left), axis: 'x' as const, value: left },
          { distance: Math.abs(right - resolved.x), axis: 'x' as const, value: right },
          { distance: Math.abs(resolved.z - near), axis: 'z' as const, value: near },
          { distance: Math.abs(far - resolved.z), axis: 'z' as const, value: far },
        ].sort((a, b) => a.distance - b.distance);
        const nearest = pushes[0];
        resolved[nearest.axis] = nearest.value;
      }
    }
    return resolved;
  }

  applyMobilityAction(roadId: string, action: MobilityRoadAction): void {
    const lane = this.lanes.find(candidate => candidate.id === roadId);
    if (!lane) return;
    if (action === 'release') {
      // Libera a faixa e, junto com ela, qualquer outra do mesmo sentido fechada antes.
      this.lanes.filter(candidate => candidate.type === 'PRINCIPAL')
        .forEach(candidate => { candidate.status = 'open'; });
      if (!this.isElectricChargerBroken()) this.electricDetour = false;
      this.blockAnchorX = null;
    }
    if (action === 'block' || action === 'blockAll') this.blockAnchorX = this.playerPosition?.x ?? this.pedestrianCrossingX;
    if (action === 'block') this.lanes.filter(candidate => candidate.type === 'PRINCIPAL' && candidate.direction === lane.direction).forEach(candidate => { candidate.status = 'blocked'; });
    if (action === 'blockAll') {
      this.lanes.filter(candidate => candidate.type === 'PRINCIPAL')
        .forEach(candidate => { candidate.status = 'blocked'; });
    }
    if (action === 'reverse') {
      const directionLane = lane.type === 'GREEN' ? null : lane;
      if (directionLane) {
        directionLane.direction = directionLane.direction === directionLane.normalDirection ? -directionLane.normalDirection as 1 | -1 : directionLane.normalDirection;
        directionLane.arrows.children.forEach(marker => { (marker as Mesh).rotation.z = directionLane.direction === 1 ? 0 : Math.PI; });
        this.vehicles.filter(vehicle => vehicle.lane === directionLane).forEach(vehicle => { vehicle.mesh.rotation.y = directionLane.direction === 1 ? 0 : Math.PI; });
      }
    }
    if (action === 'electricDetour') this.electricDetour = !this.electricDetour;
    this.lanes.forEach(candidate => this.syncLaneVisual(candidate));
    this.publishRoadState(true);
  }

  private removeCone(cone: ConeObstacle): void {
    cone.lane.coneGroup.remove(cone.mesh);
    cone.mesh.clear();
    const index = this.cones.indexOf(cone);
    if (index >= 0) this.cones.splice(index, 1);
  }

  toggleRunning(): boolean {
    this.running = !this.running;
    this.publishRoadState(true);
    return this.running;
  }

  /**
   * `waiting` é a quantidade de pedestres aguardando (o ActiveMobilitySystem
   * publica o tamanho do grupo formado); qualquer valor acima de zero chama o
   * ciclo amarelo → vermelho para os veículos.
   */
  setPedestrianCrossingState(waiting: number | boolean, occupied: boolean): void {
    this.waitingPedestrians = typeof waiting === 'number' ? waiting : waiting ? CROSSING_RULES.roadGroupSize : 0;
    this.pedestrianCrossingOccupied = occupied;
  }

  getPedestrianSignalPhase(): 'green' | 'yellow' | 'red' { return this.crossingSignalPhase; }

  isPedestrianCrossingClear(): boolean {
    if (this.unsafeCrossing && !this.guardedCrossing) return false;
    const vehiclesStopped = this.areVehiclesStoppedForCrossing();
    if (this.waitingPedestrians < CROSSING_RULES.roadGroupSize && !this.assistedCrossingRequested
      && !this.guardedCrossing && !vehiclesStopped) return false;
    // A stopped approach is the clearance condition; don't keep people at the
    // curb waiting for a signal phase that can be delayed by traffic incidents.
    return vehiclesStopped;
  }

  areVehiclesStoppedForCrossing(): boolean {
    return this.vehicles.every(vehicle => {
      const distance = (this.pedestrianCrossingX - vehicle.mesh.position.x) * vehicle.lane.direction;
      // A falha do semáforo pode congelar um carro em cima da faixa. Um carro
      // parado nessa área não deve deixar a travessia presa para sempre.
      if (distance >= -CROSSING_CAR_CLEARANCE && distance <= CROSSING_CAR_CLEARANCE) {
        return vehicle.speed <= CROSSING_RULES.stoppedSpeed;
      }
      return distance < -CROSSING_CAR_CLEARANCE || distance > CROSSING_RULES.roadApproachDistance
        || vehicle.speed <= CROSSING_RULES.stoppedSpeed;
    });
  }

  private updateCrossingSignal(dt: number): void {
    if (this.guardedCrossing || this.assistedCrossingRequested || this.pedestrianCrossingOccupied || (!this.unsafeCrossing && this.waitingPedestrians > 0)) {
      if (this.crossingSignalPhase === 'green') {
        this.crossingSignalPhase = 'yellow';
        this.crossingSignalTimer = 1.25;
      } else if (this.crossingSignalPhase === 'yellow') {
        this.crossingSignalTimer -= dt;
        if (this.crossingSignalTimer <= 0) this.crossingSignalPhase = 'red';
      }
    } else if (this.crossingSignalPhase === 'red') {
      this.crossingSignalPhase = 'yellow';
      this.crossingSignalTimer = 0.65;
    } else if (this.crossingSignalPhase === 'yellow') {
      this.crossingSignalTimer -= dt;
      if (this.crossingSignalTimer <= 0) this.crossingSignalPhase = 'green';
    }
  }

  private updateTrafficGeneration(dt: number): void {
    if (!this.running) return;
    this.demandClock += dt;
    // A 55-second demand wave moves from light traffic to a short rush and back.
    this.demandLevel = this.scheduledDemand ?? (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.demandClock * Math.PI * 2 / 55 - Math.PI / 6)));
    for (const lane of this.lanes) {
      if (lane.type !== 'PRINCIPAL' || this.reservedLanes.has(lane.id)) continue;
      const remaining = (this.spawnTimers.get(lane.id) ?? 2) - dt;
      this.spawnTimers.set(lane.id, remaining);
      if (remaining > 0 || !this.trySpawnVehicle(lane)) continue;
      const interval = this.scheduledDemand === null
        ? 5.3 - this.demandLevel * 3.5 + this.randomTraffic() * 0.55
        : 9 - this.demandLevel * 7.6 + this.randomTraffic() * 0.4;
      this.spawnTimers.set(lane.id, interval);
    }
    this.electricSpawnClock -= dt;
    if (this.electricSpawnClock <= 0) {
      const greenLane = this.lanes.find(lane => lane.type === 'GREEN')!;
      const spawnLane = this.electricDetour
        ? this.lanes.find(lane => lane.type === 'PRINCIPAL' && lane.direction === 1)!
        : greenLane;
      if (this.spawnElectricVehicle(spawnLane)) this.electricSpawnClock = 7.2 + this.randomTraffic() * 2.3;
    }
  }

  private trySpawnVehicle(lane: Lane, spawnX?: number): boolean {
    if (this.vehicles.filter(vehicle => vehicle.lane === lane).length >= this.maxVehiclesPerLane) return false;
    const entryX = spawnX ?? (lane.direction === 1 ? this.roadMinX : this.roadMinX + this.roadSpan);
    const entryIsClear = this.vehicles.every(vehicle => {
      if (Math.abs(vehicle.mesh.position.z - lane.z) >= 0.72) return true;
      return Math.abs(vehicle.mesh.position.x - entryX) >= SAFE_GAP;
    });
    if (!entryIsClear) return false;

    const mesh = this.makeVehicle();
    mesh.position.set(entryX, 0.27, lane.z);
    mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
    this.group.add(mesh);
    const maxSpeed = 1.6 + this.randomTraffic() * 0.7;
    this.vehicles.push({ id: this.nextVehicleId(), mesh, lane, homeLane: lane, preferredLane: lane, kind: mesh.userData.vehicleKind as VehicleKind,
      speed: 0, crossingCommitted: false, maxSpeed, laneChangeFromZ: lane.z, laneChangeElapsed: LANE_CHANGE_DURATION,
      chargeTargetIndex: 0, chargeElapsed: 0, charging: false, chargeRing: null,
      lastProgressAt: this.elapsedSeconds, stoppedSince: null, stopReason: 'none' });
    this.createdVehicleCount++;
    return true;
  }

  private spawnElectricVehicle(lane: Lane, spawnX?: number, targetIndex?: number): boolean {
    if (lane.type !== 'GREEN' && lane.type !== 'PRINCIPAL') return false;
    if (this.vehicles.filter(vehicle => vehicle.lane === lane).length >= (lane.type === 'GREEN' ? this.maxGreenVehicles : this.maxVehiclesPerLane)) return false;
    const entryX = spawnX ?? (lane.direction === 1 ? this.roadMinX : this.roadMinX + this.roadSpan);
    if (!this.vehicles.every(vehicle => Math.abs(vehicle.mesh.position.z - lane.z) >= 0.72
      || Math.abs(vehicle.mesh.position.x - entryX) >= SAFE_GAP)) return false;
    const sequence = this.electricSpawnIndex++;
    const kind: VehicleKind = sequence % 2 === 0 ? 'ev-sedan' : 'ev-crossover';
    const colors = ['#f2f1e8', '#86c4b0'] as const;
    const mesh = this.makeVehicle(kind, colors[sequence % colors.length]);
    const greenLane = this.lanes.find(candidate => candidate.type === 'GREEN')!;
    const chargeTargetIndex = targetIndex ?? sequence % this.chargers.length;
    mesh.position.set(entryX, 0.27, lane.z);
    mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
    this.group.add(mesh);
    const maxSpeed = 1.7 + this.randomTraffic() * 0.4;
    const chargeRing = this.createChargeRing();
    mesh.add(chargeRing);
    this.vehicles.push({ id: this.nextVehicleId(), mesh, lane, homeLane: greenLane, preferredLane: greenLane, kind, speed: 0, crossingCommitted: false, maxSpeed,
      laneChangeFromZ: lane.z, laneChangeElapsed: LANE_CHANGE_DURATION, chargeTargetIndex,
      chargeElapsed: 0, charging: false, chargeRing, lastProgressAt: this.elapsedSeconds,
      stoppedSince: null, stopReason: 'none' });
    this.createdVehicleCount++;
    return true;
  }

  private createChargeRing(): Group {
    const ring = new Group();
    ring.name = 'electric-charge-progress';
    ring.position.y = -0.23;
    ring.visible = false;
    const segments = 28;
    for (let index = 0; index < segments; index++) {
      const angle = index / segments * Math.PI * 2;
      const marker = new Mesh(this.chargeSegmentGeometry, this.chargeSegmentOffMaterial);
      marker.position.set(Math.cos(angle) * 0.69, 0, Math.sin(angle) * 0.69);
      marker.rotation.y = -angle;
      marker.renderOrder = 3;
      ring.add(marker);
    }
    return ring;
  }

  private randomTraffic(): number {
    this.trafficRandomSeed = (this.trafficRandomSeed * 16807) % 2147483647;
    return (this.trafficRandomSeed - 1) / 2147483646;
  }

  private nextVehicleId(): string { return `vehicle-${++this.vehicleIdSequence}`; }

  private removeVehicle(vehicle: Vehicle): void {
    this.group.remove(vehicle.mesh);
    vehicle.mesh.clear();
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) this.vehicles.splice(index, 1);
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05);
    this.elapsedSeconds += dt;
    this.roadStatePublishElapsed += dt;
    this.updateCrossingSignal(dt);
    this.updateTrafficGeneration(dt);
    this.incidentTime += dt;
    this.updateTowTruck(dt);
    this.incidentLights.visible = Math.floor(this.incidentTime * 3) % 2 === 0;
    for (const vehicle of [...this.vehicles]) {
      if (vehicle === this.incidentVehicle) continue;
      this.updateElectricRoute(vehicle);
      const charging = this.updateElectricCharging(vehicle, dt);
      const obstructionDistance = this.distanceToCone(vehicle);
      const ahead = this.distanceToVehicleAhead(vehicle);
      const gap = ahead - VEHICLE_LENGTH;
      const following = MathUtils.clamp((gap - 1.4) / (SAFE_GAP - 1.4), 0, 1);
      const coneAhead = obstructionDistance <= CONE_LOOKAHEAD;
      if (vehicle !== this.collisionWarningVehicle && !vehicle.tow) {
        if (coneAhead || vehicle.lane.status === 'blocked') this.tryChangeLane(vehicle, coneAhead);
        else this.tryReturnToPreferredLane(vehicle);
      }
      const crossingDistance = (this.pedestrianCrossingX - vehicle.mesh.position.x) * vehicle.lane.direction;
      const carsYield = this.guardedCrossing || this.assistedCrossingRequested || this.pedestrianCrossingOccupied
        || (!this.unsafeCrossing && this.waitingPedestrians > 0);
      const crossingStopRequested = !this.running || this.signalFailure || carsYield;
      const brakingDistance = vehicle.speed * vehicle.speed / (2 * TRAFFIC_BRAKING);
      if (!vehicle.crossingCommitted && crossingStopRequested && crossingDistance >= -CROSSING_CAR_CLEARANCE
        && (crossingDistance <= CROSSING_CAR_CLEARANCE
          || vehicle.speed > KEEP_CLEAR_SPEED && crossingDistance <= CROSSING_RULES.roadStopDistance + brakingDistance)) {
        vehicle.crossingCommitted = true;
      }
      if (vehicle.crossingCommitted && crossingDistance < -CROSSING_CAR_CLEARANCE) vehicle.crossingCommitted = false;
      const stopBeforeCrossing = crossingStopRequested && crossingDistance >= -CROSSING_CAR_CLEARANCE && !vehicle.crossingCommitted;
      const crossingRoom = stopBeforeCrossing
        ? Math.max(0, crossingDistance - CROSSING_RULES.roadStopDistance) : Infinity;
      const coneBrake = vehicle.crossingCommitted || !Number.isFinite(obstructionDistance) ? 1
        : MathUtils.clamp((obstructionDistance - CONE_STOP_DISTANCE) / (CONE_LOOKAHEAD - CONE_STOP_DISTANCE), 0, 1);
      const keepClearRoom = this.keepClearRoom(vehicle, crossingDistance);
      const playerBrake = vehicle.crossingCommitted ? 1 : this.getPlayerBrake(vehicle);
      // Interditar a pista retém quem ainda vai chegar ao ponto bloqueado: o carro
      // segue até a retenção e para ali, sem frear no meio da avenida. Quem já
      // entrou na área de conflito ou passou dela segue até sair do mapa.
      const blockDistance = this.blockAnchorX === null ? 0 : (this.blockAnchorX - vehicle.mesh.position.x) * vehicle.lane.direction;
      const pastBlock = vehicle.lane.status === 'blocked' && this.blockAnchorX !== null
        && blockDistance < CROSSING_RULES.roadConflictHalfWidth;
      const blockRoom = vehicle.lane.status === 'blocked' && !pastBlock && !vehicle.crossingCommitted
        ? Math.max(0, blockDistance - BLOCK_STOP_DISTANCE) : Infinity;
      const towRoom = vehicle === this.towTruck ? this.getTowRoom(vehicle) : Infinity;
      // Na faixa verde durante o desvio, o elétrico desacelera para encontrar um vão e entrar na via comum.
      const detourMerge = this.electricDetour && vehicle.lane.type === 'GREEN' && this.isElectricVehicle(vehicle.kind)
        ? DETOUR_MERGE_SPEED_FACTOR : 1;
      let targetSpeed = !stopBeforeCrossing && !charging.stopped
        ? vehicle.maxSpeed * following * coneBrake * playerBrake * charging.brake * detourMerge : 0;
      if (vehicle === this.collisionWarningVehicle) targetSpeed *= 0.35;
      if (gap <= MIN_BUMPER_GAP) targetSpeed = 0;
      const stoppedAtCone = !vehicle.crossingCommitted && Number.isFinite(obstructionDistance) && obstructionDistance <= CONE_STOP_DISTANCE;
      const coneRoom = vehicle.crossingCommitted || !Number.isFinite(obstructionDistance)
        ? Infinity : Math.max(0, obstructionDistance - CONE_STOP_DISTANCE);
      const room = Math.min(crossingRoom, keepClearRoom, Math.max(0, gap - MIN_BUMPER_GAP), coneRoom,
        charging.stopDistance, blockRoom, towRoom);
      const motion = advanceWithRoom(vehicle.speed, targetSpeed, room, dt, 1.8, TRAFFIC_BRAKING);
      vehicle.speed = gap <= MIN_BUMPER_GAP || stoppedAtCone ? 0 : motion.speed;
      const travel = gap <= MIN_BUMPER_GAP || stoppedAtCone ? 0 : motion.distance;
      vehicle.mesh.position.x += vehicle.lane.direction * travel;
      const stopReason: TrafficStopReason = !this.running ? 'manual-stop'
        : charging.stopped ? 'charging'
          : vehicle.lane.status === 'blocked' && !pastBlock ? 'lane-blocked'
            : stopBeforeCrossing || crossingRoom <= .001 ? 'crossing'
              : stoppedAtCone || coneRoom <= .001 ? 'cone'
                : gap <= MIN_BUMPER_GAP || following <= .001 ? 'vehicle-ahead'
                  : playerBrake <= .001 ? 'player' : 'none';
      if (travel > .001) {
        vehicle.lastProgressAt = this.elapsedSeconds;
        vehicle.stoppedSince = null;
        vehicle.stopReason = 'none';
      } else if (vehicle.speed <= CROSSING_RULES.stoppedSpeed) {
        vehicle.stoppedSince ??= this.elapsedSeconds;
        vehicle.stopReason = stopReason;
      }
      if (vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) {
        vehicle.laneChangeElapsed = Math.min(LANE_CHANGE_DURATION, vehicle.laneChangeElapsed + dt);
        const progress = vehicle.laneChangeElapsed / LANE_CHANGE_DURATION;
        const smoothProgress = progress * progress * (3 - 2 * progress);
        vehicle.mesh.position.z = MathUtils.lerp(vehicle.laneChangeFromZ, vehicle.lane.z, smoothProgress);
      } else {
        vehicle.mesh.position.z = vehicle.lane.z;
      }
      if ((vehicle.lane.direction === 1 && vehicle.mesh.position.x > this.roadMinX + this.roadSpan)
        || (vehicle.lane.direction === -1 && vehicle.mesh.position.x < this.roadMinX)) {
        if (vehicle === this.towTruck) {
          this.towTruck = null;
          if (this.towTruckState !== 'idle') this.towTruckState = 'completed';
        }
        this.removeVehicle(vehicle);
        this.exitedVehicleCount++;
      }
    }
    this.publishRoadState();
  }

  /** Snapshot barato e sem referências mutáveis para testes e diagnóstico de desenvolvimento. */
  getDiagnostics(): TrafficDiagnostics {
    const stoppedVehicles = this.vehicles.filter(vehicle => vehicle.speed <= CROSSING_RULES.stoppedSpeed).map(vehicle => ({
      id: vehicle.id,
      laneId: vehicle.lane.id,
      reason: vehicle === this.incidentVehicle ? 'incident' as const : vehicle.stopReason,
      stoppedForSeconds: Math.max(0, this.elapsedSeconds - (vehicle.stoppedSince ?? this.elapsedSeconds)),
      lastProgressSecondsAgo: Math.max(0, this.elapsedSeconds - vehicle.lastProgressAt),
    }));
    const persistentInvalidBlocks = stoppedVehicles
      .filter(vehicle => vehicle.stoppedForSeconds >= 45
        && !['incident', 'manual-stop', 'lane-blocked', 'charging'].includes(vehicle.reason))
      .map(vehicle => `${vehicle.id}:${vehicle.reason}:${vehicle.stoppedForSeconds.toFixed(1)}s`);
    return {
      elapsedSeconds: this.elapsedSeconds,
      activeVehicles: this.vehicles.length,
      movingVehicles: this.getMovingVehicleCount(),
      spawnedVehicles: this.createdVehicleCount,
      exitedVehicles: this.exitedVehicleCount,
      stoppedVehicles,
      lanes: this.lanes.map(lane => {
        const vehicles = this.vehicles.filter(vehicle => vehicle.lane === lane);
        return { id: lane.id, status: lane.status, direction: lane.direction,
          vehicles: vehicles.length, moving: vehicles.filter(vehicle => vehicle.speed > .4).length };
      }),
      crossing: { phase: this.crossingSignalPhase, waitingPedestrians: this.waitingPedestrians,
        occupied: this.pedestrianCrossingOccupied, guarded: this.guardedCrossing, assisted: this.assistedCrossingRequested },
      occurrences: [this.incidentVehicle ? 'vehicle-incident' : null,
        this.towTruckState !== 'idle' && this.towTruckState !== 'completed' ? `tow-${this.towTruckState}` : null]
        .filter((value): value is string => value !== null),
      persistentInvalidBlocks,
    };
  }

  /** Freia ao ver o personagem a pé na própria faixa, logo à frente. */
  private getPlayerBrake(vehicle: Vehicle): number {
    const player = this.playerPosition;
    if (!player) return 1;
    if (Math.abs(player.z - vehicle.mesh.position.z) > 0.75) return 1;
    const distance = (player.x - vehicle.mesh.position.x) * vehicle.lane.direction;
    if (distance <= 0 || distance >= CROSSING_BRAKE_DISTANCE) return 1;
    return MathUtils.clamp((distance - CROSSING_STOP_DISTANCE) / (CROSSING_BRAKE_DISTANCE - CROSSING_STOP_DISTANCE), 0, 1);
  }

  private isElectricVehicle(kind: VehicleKind): boolean {
    return kind === 'ev-sedan' || kind === 'ev-crossover';
  }

  private updateElectricRoute(vehicle: Vehicle): void {
    if (!this.isElectricVehicle(vehicle.kind) || vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) return;
    const greenLane = this.lanes.find(lane => lane.type === 'GREEN')!;
    if (this.electricDetour && vehicle.lane === greenLane) {
      const destination = this.lanes.filter(lane => lane.type === 'PRINCIPAL' && lane.direction === greenLane.direction && lane.status === 'open')
        .filter(lane => this.hasDetourMergeSpace(lane, vehicle))
        .sort((a, b) => this.getLaneCongestion(a) - this.getLaneCongestion(b))[0];
      if (destination) this.startLaneTransition(vehicle, destination);
      return;
    }
    if (!this.electricDetour && vehicle.lane.type === 'PRINCIPAL' && vehicle.homeLane === greenLane) {
      this.tryReturnToPreferredLane(vehicle);
    }
  }

  /**
   * Vão para o elétrico deixar a faixa verde: quem está atrás na via comum tem
   * distância para frear, e o carro da frente não fica colado no para-choque.
   */
  private hasDetourMergeSpace(lane: Lane, entering: Vehicle): boolean {
    const behindNeeded = VEHICLE_LENGTH + (entering.speed < KEEP_CLEAR_SPEED ? 1.85 : 1.4);
    return this.vehicles.filter(other => other !== entering
      && (other.lane === lane || Math.abs(other.mesh.position.z - lane.z) < 0.72)).every(other => {
      const offset = (other.mesh.position.x - entering.mesh.position.x) * lane.direction;
      return offset >= 0 ? offset >= DETOUR_MERGE_AHEAD : -offset >= behindNeeded;
    });
  }

  private updateElectricCharging(vehicle: Vehicle, dt: number): { brake: number; stopped: boolean; stopDistance: number } {
    if (!this.isElectricVehicle(vehicle.kind) || vehicle.lane.type !== 'GREEN' || this.electricDetour) {
      if (vehicle.chargeRing) vehicle.chargeRing.visible = false;
      vehicle.charging = false;
      vehicle.chargeElapsed = 0;
      // Desviado mas ainda na faixa verde: espera a vez de sair antes do carregador quebrado, sem passar por ele.
      const broken = this.electricDetour && this.isElectricVehicle(vehicle.kind) && vehicle.lane.type === 'GREEN'
        ? this.chargers.map(charger => (charger.x - vehicle.mesh.position.x) * vehicle.lane.direction)
          .filter((distance, index) => this.chargers[index].broken && distance >= 0.5).sort((a, b) => a - b)[0]
        : undefined;
      return { brake: 1, stopped: false, stopDistance: broken === undefined ? Infinity : Math.max(0, broken - 0.92) };
    }
    if (vehicle.chargeTargetIndex >= this.chargers.length) return { brake: 1, stopped: false, stopDistance: Infinity };
    let charger = this.chargers[vehicle.chargeTargetIndex];
    let distanceToCharger = (charger.x - vehicle.mesh.position.x) * vehicle.lane.direction;
    if (!vehicle.charging && distanceToCharger < -0.1) {
      const nextIndex = this.chargers.findIndex((candidate, index) => index > vehicle.chargeTargetIndex
        && (candidate.x - vehicle.mesh.position.x) * vehicle.lane.direction > 0.5);
      vehicle.chargeTargetIndex = nextIndex < 0 ? this.chargers.length : nextIndex;
      if (vehicle.chargeTargetIndex >= this.chargers.length) return { brake: 1, stopped: false, stopDistance: Infinity };
      charger = this.chargers[vehicle.chargeTargetIndex];
      distanceToCharger = (charger.x - vehicle.mesh.position.x) * vehicle.lane.direction;
    }
    if (vehicle.charging) {
      if (charger.broken) {
        vehicle.charging = false;
        vehicle.chargeElapsed = 0;
        if (vehicle.chargeRing) vehicle.chargeRing.visible = false;
      } else {
        vehicle.speed = 0;
        vehicle.chargeElapsed += dt;
        this.updateChargeRing(vehicle, Math.min(1, vehicle.chargeElapsed / 4.5));
        if (vehicle.chargeElapsed >= 4.5) {
          vehicle.charging = false;
          vehicle.chargeElapsed = 0;
          vehicle.chargeTargetIndex += 1;
          if (vehicle.chargeRing) vehicle.chargeRing.visible = false;
        }
        return { brake: 1, stopped: true, stopDistance: 0 };
      }
    }
    if (charger.broken) {
      const distanceToQueueStop = distanceToCharger - 0.92;
      return { brake: distanceToCharger <= 3.2 ? MathUtils.clamp(distanceToQueueStop / 2.3, 0, 1) : 1,
        stopped: distanceToCharger <= 0.95 && distanceToCharger >= -0.1,
        stopDistance: Math.max(0, distanceToQueueStop) };
    }
    const distanceToChargeStop = distanceToCharger - 0.44;
    const brake = distanceToCharger <= 3.1 ? MathUtils.clamp(distanceToChargeStop / 2.65, 0, 1) : 1;
    if (distanceToCharger <= 0.5 && distanceToCharger >= -0.1) {
      vehicle.mesh.position.x = charger.x - vehicle.lane.direction * 0.44;
      vehicle.speed = 0;
      vehicle.charging = true;
      vehicle.chargeElapsed = 0;
      if (vehicle.chargeRing) vehicle.chargeRing.visible = true;
      this.updateChargeRing(vehicle, 0);
      return { brake: 1, stopped: true, stopDistance: 0 };
    }
    return { brake, stopped: false, stopDistance: Math.max(0, distanceToChargeStop) };
  }

  private updateChargeRing(vehicle: Vehicle, progress: number): void {
    if (!vehicle.chargeRing) return;
    const litCount = Math.ceil(vehicle.chargeRing.children.length * progress);
    vehicle.chargeRing.children.forEach((segment, index) => {
      (segment as Mesh).material = index < litCount ? this.chargeSegmentOnMaterial : this.chargeSegmentOffMaterial;
    });
  }

  private startLaneTransition(vehicle: Vehicle, target: Lane): void {
    vehicle.laneChangeFromZ = vehicle.mesh.position.z;
    vehicle.laneChangeElapsed = 0;
    vehicle.lane = target;
  }

  private tryReturnToPreferredLane(vehicle: Vehicle): void {
    const preferred = vehicle.preferredLane;
    if (this.isElectricVehicle(vehicle.kind) && this.electricDetour) return;
    if (vehicle.lane.type !== 'PRINCIPAL' || vehicle.lane === preferred || preferred.status !== 'open'
      || this.hasConeNearLane(preferred, vehicle.mesh.position.x, LANE_CHANGE_LOOKAHEAD) || preferred.direction !== vehicle.lane.direction
      || vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) return;
    if (this.hasSafeSpaceAt(preferred, vehicle.mesh.position.x, vehicle.lane.direction, vehicle)) this.startLaneTransition(vehicle, preferred);
  }

  private hasSafeSpaceAt(lane: Lane, x: number, direction: 1 | -1, entering: Vehicle): boolean {
    if (lane === entering.lane) return true;
    return this.vehicles.filter(other => other !== entering && other.lane === lane).every(other => {
      const ahead = this.distanceToPoint(x, other.mesh.position.x, direction);
      const behind = this.distanceToPoint(other.mesh.position.x, x, direction);
      return ahead >= SAFE_GAP && behind >= VEHICLE_LENGTH + 1.4;
    });
  }

  /** Métricas de trânsito olham só o trecho jogável, não a fila no cenário estendido. */
  private isOnMap(vehicle: Vehicle): boolean {
    const x = vehicle.mesh.position.x;
    return x >= this.minX && x <= this.minX + this.width;
  }

  private distanceToPoint(fromX: number, toX: number, direction: 1 | -1): number {
    const delta = direction === 1 ? toX - fromX : fromX - toX;
    return (delta + this.roadSpan) % this.roadSpan;
  }

  private getLaneCongestion(lane: Lane): number {
    const vehicles = this.vehicles.filter(vehicle => vehicle.lane === lane && this.isOnMap(vehicle));
    const speedCongestion = vehicles.length
      ? vehicles.reduce((sum, vehicle) => sum + (1 - vehicle.speed / vehicle.maxSpeed), 0) / vehicles.length : 0;
    const laneCapacity = Math.max(1, Math.floor(this.getEffectiveLaneCapacity(lane) / 15));
    const occupancy = MathUtils.clamp(vehicles.length / laneCapacity, 0, 1);
    return MathUtils.clamp(occupancy * 0.55 + speedCongestion * 0.45, 0, 1);
  }

  private getEffectiveLaneCapacity(lane: Lane): number {
    const count = this.cones.filter(cone => cone.lane === lane).length;
    return count ? Math.max(15, Math.round(lane.capacity * Math.max(0.45, 1 - count * 0.1))) : lane.capacity;
  }

  private distanceToCone(vehicle: Vehicle): number {
    let nearest = Infinity;
    if (this.incidentVehicle && this.incidentVehicle !== vehicle && this.incidentVehicle.lane === vehicle.lane) {
      const distance = (this.incidentVehicle.mesh.position.x - vehicle.mesh.position.x) * vehicle.lane.direction;
      if (distance >= 0) nearest = Math.max(0, distance - VEHICLE_LENGTH / 2);
    }
    for (const cone of this.cones) {
      if (cone.lane !== vehicle.lane) continue;
      const distance = (cone.x - vehicle.mesh.position.x) * vehicle.lane.direction;
      if (distance >= -0.18) nearest = Math.min(nearest, Math.max(0, distance));
    }
    return nearest;
  }

  private hasConeNearLane(lane: Lane, x: number, distance: number): boolean {
    return this.cones.some(cone => cone.lane === lane && Math.abs(cone.x - x) <= distance);
  }

  private tryChangeLane(vehicle: Vehicle, avoidingCone = false): void {
    if ((!avoidingCone && vehicle.lane.status !== 'blocked')
      || vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) return;
    const compatible = this.lanes.filter(lane => lane.type === 'PRINCIPAL' && lane !== vehicle.lane
      && Math.abs(lane.z - vehicle.lane.z) <= 1.15
      && lane.direction === vehicle.lane.direction && !this.hasConeNearLane(lane, vehicle.mesh.position.x, LANE_CHANGE_LOOKAHEAD) && lane.status === 'open');
    const target = compatible
      .filter(lane => this.vehicles.filter(other => other !== vehicle && other.lane === lane)
        .every(other => this.directionalDistance(vehicle, other) > SAFE_GAP && this.directionalDistance(other, vehicle) > VEHICLE_LENGTH + 1.4))
      .sort((a, b) => Math.abs(a.z - vehicle.lane.z) - Math.abs(b.z - vehicle.lane.z))[0];
    if (!target) return;
    vehicle.laneChangeFromZ = vehicle.mesh.position.z;
    vehicle.laneChangeElapsed = 0;
    vehicle.lane = target;
  }

  private directionalDistance(from: Vehicle, to: Vehicle): number {
    const raw = to.mesh.position.x - from.mesh.position.x;
    return from.lane.direction === 1 ? (raw + this.roadSpan) % this.roadSpan : (-raw + this.roadSpan) % this.roadSpan;
  }

  private nearestAhead(vehicle: Vehicle): { vehicle: Vehicle; distance: number } | null {
    let nearest: { vehicle: Vehicle; distance: number } | null = null;
    for (const other of this.vehicles) {
      if (other === vehicle) continue;
      const lateralOverlap = Math.abs(other.mesh.position.z - vehicle.mesh.position.z) < 0.72;
      if (other.lane !== vehicle.lane && !lateralOverlap) continue;
      const distance = (other.mesh.position.x - vehicle.mesh.position.x) * vehicle.lane.direction;
      if (distance > 0.001 && (!nearest || distance < nearest.distance)) nearest = { vehicle: other, distance };
    }
    return nearest;
  }

  private distanceToVehicleAhead(vehicle: Vehicle): number {
    return Math.min(this.roadSpan, this.nearestAhead(vehicle)?.distance ?? this.roadSpan);
  }

  /**
   * Não fechar a faixa de pedestres: se o carro da frente está parado logo depois
   * da faixa e não sobra espaço para um carro inteiro, quem chega espera antes dela.
   */
  private keepClearRoom(vehicle: Vehicle, crossingDistance: number): number {
    if (crossingDistance < CROSSING_RULES.roadStopDistance - .001) return Infinity;
    const front = this.nearestAhead(vehicle);
    if (!front || front.vehicle.speed > KEEP_CLEAR_SPEED) return Infinity;
    const frontPastCenter = front.distance - crossingDistance;
    if (frontPastCenter <= 0) return Infinity;
    const freeSpan = frontPastCenter - VEHICLE_LENGTH / 2 - CROSSING_RULES.roadConflictHalfWidth;
    return freeSpan < VEHICLE_LENGTH + MIN_BUMPER_GAP ? Math.max(0, crossingDistance - CROSSING_RULES.roadStopDistance) : Infinity;
  }

  private makeVehicle(requestedKind?: VehicleKind, requestedColor?: string): Group {
    const vehicle = new Group();
    vehicle.name = 'traffic-vehicle';
    const seqIndex = this.spawnedCount++;
    const kind = requestedKind ?? FLEET_SEQUENCE[seqIndex % FLEET_SEQUENCE.length];
    const color = requestedColor ?? FLEET_COLORS[seqIndex % FLEET_COLORS.length];
    const model = this.vehicleModels.create(kind, color);
    vehicle.userData.vehicleKind = kind;
    model.group.rotation.y = Math.PI / 2;
    model.group.scale.setScalar(VEHICLE_VISUAL_SCALE[kind]);
    model.group.position.y = -0.27;
    vehicle.add(model.group);
    return vehicle;
  }

  private publishRoadState(force = false): void {
    if (!this.publishState || (!force && this.roadStatePublishElapsed < 0.1)) return;
    this.roadStatePublishElapsed = 0;
    suburbanGameState.setRoads(this.getRoadStates());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.towTruck = null;
    this.vehicleModels.dispose();
    [this.barrierGeometry, this.coneGeometry, this.directionGeometry, this.towBeaconGeometry, this.towBedGeometry, this.towBoomGeometry,
      this.chargerBaseGeometry, this.chargerBodyGeometry, this.chargerScreenGeometry, this.chargerStatusGeometry, this.chargerPlugGeometry,
      this.chargerCableGeometry, this.chargeSegmentGeometry].forEach(geometry => geometry.dispose());
    [this.barrierMaterial, this.towBeaconMaterial, this.towEquipmentMaterial, this.chargerBodyMaterial, this.chargerScreenMaterial, this.chargerCableMaterial,
      this.chargeSegmentOnMaterial, this.chargeSegmentOffMaterial, this.directionMaterial, this.greenDirectionMaterial, this.blockedDirectionMaterial]
      .forEach(material => material.dispose());
    this.chargers.forEach(charger => charger.statusMaterial.dispose());
    this.group.clear();
    if (this.publishState) suburbanGameState.setRoads(this.getRoadStates().map(road => ({ ...road, vehicleCount: 0, congestion: 0, status: 'open' })));
  }
}
