import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, Shape, ShapeGeometry,
} from 'three';
import type { GridMap } from '../map/GridMap';
import { suburbanGameState, type RoadState } from '../core/GameState';

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
  mesh: Group;
  lane: Lane;
  homeLane: Lane;
  preferredLane: Lane;
  speed: number;
  maxSpeed: number;
  laneChangeFromZ: number;
  laneChangeElapsed: number;
  plannedConnectionId: string | null;
};
type TrafficConnection = {
  id: string;
  nodeId: string;
  fromLaneId: string;
  toLaneId: string;
  role: 'ENTRY' | 'EXIT';
  direction: 1 | -1;
  x: number;
};
export type MobilityRoadAction = 'release' | 'block' | 'reverse' | 'escape' | 'redirect';
export type WorkZoneReadiness = {
  prepared: boolean;
  reason: 'NEEDS_INTERVENTION' | 'WAITING_FOR_DIVERSION' | 'CARS_IN_WORK_ZONE' | 'ACCESS_TOO_NARROW' | null;
  nearbyVehicles: number;
};

const INITIAL_VEHICLES_PER_LANE = 1;
const MAX_VEHICLES_PER_LANE = 7;
const VEHICLE_LENGTH = 1.35;
const SAFE_GAP = 4.2;
const MIN_BUMPER_GAP = 0.16;
const LANE_CHANGE_DURATION = 0.7;
const LANE_CHANGE_LOOKAHEAD = 9;
const ROUTE_DECISION_THRESHOLD = 0.38;
const ROUTE_LOOKAHEAD = 8;
const CONNECTION_APPROACH_DISTANCE = 1.8;
const ESCAPE_CAPACITY = 30;
const WORK_ZONE_CLEARANCE = 2.9;
const CONE_LOOKAHEAD = 9;
const CONE_STOP_DISTANCE = VEHICLE_LENGTH / 2 + 0.3;
const CROSSING_STOP_DISTANCE = 2.45;
const CROSSING_BRAKE_DISTANCE = 7;
const CROSSING_SAFE_DISTANCE = 2.35;
const CROSSING_CLEARING_DISTANCE = 1.8;

/** Fluxo de tráfego de protótipo em duas vias principais e uma via de escape paralela. */
export class TrafficSystem {
  readonly group = new Group();
  private readonly bodyGeometry = new BoxGeometry(VEHICLE_LENGTH, 0.36, 0.56);
  private readonly cabinGeometry = new BoxGeometry(0.62, 0.3, 0.46);
  private readonly wheelGeometry = new CylinderGeometry(0.1, 0.1, 0.08, 10);
  private readonly roadGeometry = new BoxGeometry(1, 0.035, 1.78);
  private readonly connectorGeometry = new BoxGeometry(0.72, 0.045, 2.05);
  private readonly barrierGeometry = new BoxGeometry(0.15, 0.12, 1.5);
  private readonly coneGeometry = new ConeGeometry(0.22, 0.58, 8);
  private readonly materials = ['#e4a23b', '#48a9a2', '#d15e55', '#7f77bc', '#d8d5c8', '#4b6a84']
    .map(color => new MeshStandardMaterial({ color, roughness: 0.72 }));
  private readonly dark = new MeshStandardMaterial({ color: '#20272c', roughness: 0.9 });
  private readonly roadMaterial = new MeshStandardMaterial({ color: '#41494d', roughness: 0.95 });
  private readonly connectorMaterial = new MeshStandardMaterial({ color: '#41494d', roughness: 0.95 });
  private readonly barrierMaterial = new MeshStandardMaterial({ color: '#da584b', emissive: '#512018', roughness: 0.65 });
  private readonly directionGeometry: ShapeGeometry;
  private readonly directionMaterial = new MeshStandardMaterial({ color: '#d8e3dc', emissive: '#253a35', side: 2, roughness: 0.8 });
  private readonly escapeDirectionMaterial = new MeshStandardMaterial({ color: '#8ee0b4', emissive: '#1d5038', side: 2, roughness: 0.8 });
  private readonly blockedDirectionMaterial = new MeshStandardMaterial({ color: '#ff7668', emissive: '#622016', side: 2, roughness: 0.8 });
  private readonly vehicles: Vehicle[] = [];
  private readonly cones: ConeObstacle[] = [];
  private readonly spawnTimers = new Map<string, number>();
  private readonly lanes: Lane[];
  private readonly connections: TrafficConnection[];
  private readonly minX: number;
  private readonly width: number;
  private running = true;
  private redirecting = false;
  private escapeSourceId = 'orla-eastbound';
  private mobilityView = false;
  private pedestrianCrossingRequested = false;
  private pedestrianCrossingOccupied = false;
  private crossingSignalPhase: 'green' | 'yellow' | 'red' = 'green';
  private crossingSignalTimer = 0;
  private demandClock = 0;
  private demandLevel = 0.5;
  private trafficRandomSeed = 173;
  private readonly pedestrianCrossingX = 1;
  private disposed = false;

  constructor(map: GridMap) {
    this.group.name = 'traffic-flow';
    this.width = map.width;
    this.minX = -map.width / 2;
    const arrowShape = new Shape();
    arrowShape.moveTo(-0.38, -0.16); arrowShape.lineTo(0.05, -0.16); arrowShape.lineTo(0.05, -0.3);
    arrowShape.lineTo(0.42, 0); arrowShape.lineTo(0.05, 0.3); arrowShape.lineTo(0.05, 0.16); arrowShape.lineTo(-0.38, 0.16); arrowShape.closePath();
    this.directionGeometry = new ShapeGeometry(arrowShape);
    const mainRoadZ = map.cellCenter(0, map.rows - 1).z;
    const roadLowEdge = mainRoadZ - map.tileSize * 1.5;
    const escapeRoadZ = roadLowEdge + map.tileSize * 0.2;
    this.lanes = [
      this.createLane('orla-eastbound', 1, roadLowEdge + map.tileSize * 0.6, 'PRINCIPAL', 100, 1),
      this.createLane('orla-eastbound-2', 1, roadLowEdge + map.tileSize, 'PRINCIPAL', 100, 1),
      this.createLane('orla-westbound', -1, roadLowEdge + map.tileSize * 1.4, 'PRINCIPAL', 100, 1),
      this.createLane('orla-westbound-2', -1, roadLowEdge + map.tileSize * 1.8, 'PRINCIPAL', 100, 1),
      this.createLane('orla-escape', 1, escapeRoadZ, 'ESCAPE', ESCAPE_CAPACITY, 0, 'blocked'),
    ];
    this.connections = this.createConnections();
    this.createEscapeConnectors(mainRoadZ, escapeRoadZ);
    this.lanes.forEach((lane, laneIndex) => {
      if (lane.type === 'ESCAPE') return;
      this.spawnTimers.set(lane.id, 1.4 + laneIndex * 0.65);
      for (let index = 0; index < INITIAL_VEHICLES_PER_LANE; index++) {
        const vehicleIndex = laneIndex * INITIAL_VEHICLES_PER_LANE + index;
        const material = this.materials[vehicleIndex % this.materials.length];
        const mesh = this.makeVehicle(material);
        const startFraction = [0.2, 0.42, 0.63, 0.83][laneIndex % 4];
        const start = this.minX + this.width * startFraction;
        mesh.position.set(start, 0.27, lane.z);
        mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
        this.group.add(mesh);
        const maxSpeed = 1.6 + ((vehicleIndex + laneIndex) % 3) * 0.35;
        this.vehicles.push({ mesh, lane, homeLane: lane, preferredLane: lane, speed: maxSpeed, maxSpeed, laneChangeFromZ: lane.z, laneChangeElapsed: LANE_CHANGE_DURATION, plannedConnectionId: null });
      }
    });
    this.setMobilityView(false);
    this.publishRoadState();
  }

  private createConnections(): TrafficConnection[] {
    const escape = this.lanes.find(lane => lane.type === 'ESCAPE')!;
    const escapeOpen = escape.status === 'open';
    const leftNodeX = this.minX + 1.4;
    const rightNodeX = this.minX + this.width - 1.4;
    return this.lanes.filter(lane => lane.type === 'PRINCIPAL').flatMap(lane => ([1, -1] as const).flatMap(direction => {
      const entryX = direction === 1 ? leftNodeX : rightNodeX;
      const exitX = direction === 1 ? rightNodeX : leftNodeX;
      return [
        { id: `${lane.id}-to-escape-${direction}`, nodeId: direction === 1 ? 'west-escape-junction' : 'east-escape-junction', fromLaneId: lane.id, toLaneId: escape.id, role: 'ENTRY' as const, direction, x: entryX },
        { id: `escape-to-${lane.id}-${direction}`, nodeId: direction === 1 ? 'east-escape-junction' : 'west-escape-junction', fromLaneId: escape.id, toLaneId: lane.id, role: 'EXIT' as const, direction, x: exitX },
      ];
    }));
  }

  private createLane(id: string, direction: 1 | -1, z: number, type: Lane['type'], capacity: number, priority: number, initialStatus: Lane['status'] = 'open'): Lane {
    const arrows = new Group();
    arrows.name = `direction-markers-${id}`;
    const count = type === 'ESCAPE' ? 5 : 7;
    for (let i = 0; i < count; i++) {
      const marker = new Mesh(this.directionGeometry, type === 'ESCAPE' ? this.escapeDirectionMaterial : this.directionMaterial);
      marker.rotation.x = -Math.PI / 2;
      marker.rotation.z = direction === 1 ? 0 : Math.PI;
      marker.position.set(this.minX + this.width * (i + 0.5) / count, 0.055, z);
      arrows.add(marker);
    }
    this.group.add(arrows);
    const barriers = new Group();
    if (type === 'ESCAPE') {
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
    if (type === 'ESCAPE') {
      arrows.children.forEach(marker => { (marker as Mesh).position.y = 0.055; });
    }
    this.syncLaneVisual(lane);
    return lane;
  }

  private createEscapeConnectors(mainZ: number, escapeZ: number): void {
    for (const x of [this.minX + 1.4, -this.minX - 1.4]) {
      const connector = new Mesh(this.connectorGeometry, this.connectorMaterial);
      connector.position.set(x, 0.012, (mainZ + escapeZ) / 2);
      this.group.add(connector);
    }
    // A clear asphalt strip makes the escape lane legible even when it is closed.
    const road = new Mesh(this.roadGeometry, this.roadMaterial);
    road.scale.x = this.width;
    road.scale.z = 0.8 / 1.78;
    road.position.set(0, 0, escapeZ);
    this.group.add(road);
  }

  private syncLaneVisual(lane: Lane): void {
    lane.barriers.visible = lane.status === 'blocked';
    lane.arrows.visible = this.mobilityView;
    lane.arrows.children.forEach(marker => {
      const mesh = marker as Mesh;
      mesh.rotation.z = lane.direction === 1 ? 0 : Math.PI;
      if (lane.status === 'blocked') mesh.material = this.blockedDirectionMaterial;
      else if (lane.type === 'ESCAPE') mesh.material = this.escapeDirectionMaterial;
      else mesh.material = this.directionMaterial;
    });
  }

  setMobilityView(visible: boolean): void {
    this.mobilityView = visible;
    this.lanes.forEach(lane => this.syncLaneVisual(lane));
  }

  getNearbyLane(x: number, z: number): string | null {
    if (x < this.minX || x > this.minX + this.width) return null;
    const lane = this.lanes.reduce((nearest, candidate) => Math.abs(candidate.z - z) < Math.abs(nearest.z - z) ? candidate : nearest);
    return Math.abs(z - lane.z) <= 1.2 ? lane.id : null;
  }

  getNearestPrincipalLanePosition(position: { x: number; z: number }): { x: number; z: number } {
    const lane = this.lanes.filter(candidate => candidate.type === 'PRINCIPAL')
      .reduce((nearest, candidate) => Math.abs(candidate.z - position.z) < Math.abs(nearest.z - position.z) ? candidate : nearest);
    return { x: MathUtils.clamp(position.x, this.minX + 0.8, this.minX + this.width - 0.8), z: lane.z };
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
    this.publishRoadState();
    return true;
  }

  removeNearestCone(x: number, z: number, radius = 1.8): boolean {
    const nearest = this.cones.map(cone => ({ cone, distance: Math.hypot(cone.x - x, cone.lane.z - z) }))
      .filter(candidate => candidate.distance <= radius).sort((a, b) => a.distance - b.distance)[0]?.cone;
    if (!nearest) return false;
    this.removeCone(nearest);
    this.publishRoadState();
    return true;
  }

  getActiveInterventionPosition(reference: { x: number; z: number }): { x: number; z: number } | null {
    const affected = this.lanes.filter(lane => lane.type === 'PRINCIPAL'
      ? lane.status === 'blocked' || this.cones.some(cone => cone.lane === lane) || lane.direction !== lane.normalDirection
      : lane.type === 'ESCAPE' && lane.status === 'open');
    const lane = affected.sort((a, b) => Math.abs(a.z - reference.z) - Math.abs(b.z - reference.z))[0];
    if (!lane) return null;
    const cone = this.cones.filter(item => item.lane === lane)
      .sort((a, b) => Math.abs(a.x - reference.x) - Math.abs(b.x - reference.x))[0];
    const x = cone?.x ?? reference.x;
    return { x: MathUtils.clamp(x, this.minX + 0.8, this.minX + this.width - 0.8), z: lane.z };
  }

  getRoadStates(): RoadState[] {
    return this.lanes.map(lane => {
      const vehicles = this.vehicles.filter(vehicle => vehicle.lane === lane);
      const congestion = this.getLaneCongestion(lane);
      return {
        id: lane.id,
        direction: lane.direction === lane.normalDirection ? 'NORMAL' : 'REVERSE',
        status: this.running ? lane.status === 'open' ? 'open' : 'blocked' : 'stopped',
        type: lane.type,
        capacity: this.getEffectiveLaneCapacity(lane),
        priority: lane.priority,
        redirected: lane.type === 'ESCAPE' ? vehicles.length > 0 || (this.redirecting && lane.status === 'open') : this.vehicles.some(vehicle => vehicle.lane.type === 'ESCAPE' && vehicle.homeLane === lane) || (this.redirecting && lane.id === this.escapeSourceId),
        vehicleCount: vehicles.length,
        congestion: lane.status === 'blocked' && vehicles.length ? 1 : congestion,
        conesActive: this.cones.some(cone => cone.lane === lane),
        coneZoneId: null,
      };
    });
  }

  getWorkZoneReadiness(position: { x: number; z: number }): WorkZoneReadiness {
    const principalLanes = this.lanes.filter(lane => lane.type === 'PRINCIPAL');
    const workLane = principalLanes.reduce((nearest, lane) => Math.abs(lane.z - position.z) < Math.abs(nearest.z - position.z) ? lane : nearest);
    const approachSpace = Math.abs(workLane.z - position.z) - this.bodyGeometry.parameters.depth / 2;
    const escape = this.lanes.find(lane => lane.type === 'ESCAPE')!;
    const escapeOpen = escape.status === 'open';
    const workCones = this.cones.filter(cone => cone.lane === workLane && Math.abs(cone.x - position.x) <= 3.2);
    const coneIntervention = workCones.length > 0;
    const escapeIntervention = escape.status === 'open'
      && this.vehicles.some(vehicle => vehicle.lane === escape && vehicle.homeLane.direction === workLane.direction);
    const nearbyVehicles = this.vehicles.filter(vehicle =>
      Math.hypot(vehicle.mesh.position.x - position.x, vehicle.mesh.position.z - position.z) <= WORK_ZONE_CLEARANCE).length;
    const vehiclesRespectingCones = !coneIntervention || !this.vehicles.some(vehicle => workCones.some(cone =>
      Math.abs(vehicle.mesh.position.x - cone.x) < VEHICLE_LENGTH && Math.abs(vehicle.mesh.position.z - cone.lane.z) < 0.72));
    const spaceAvailable = approachSpace >= 0.9;
    const prepared = (coneIntervention || escapeIntervention) && vehiclesRespectingCones && nearbyVehicles === 0 && spaceAvailable;
    const reason: WorkZoneReadiness['reason'] = prepared ? null
      : !spaceAvailable ? 'ACCESS_TOO_NARROW'
        : !(coneIntervention || escapeIntervention) && escapeOpen ? 'WAITING_FOR_DIVERSION'
          : !(coneIntervention || escapeIntervention) ? 'NEEDS_INTERVENTION'
          : 'CARS_IN_WORK_ZONE';
    return { prepared, reason, nearbyVehicles };
  }

  resolveWorkerMovement(from: { x: number; z: number }, to: { x: number; z: number }, radius: number): { x: number; z: number } {
    const resolved = { ...to };
    for (const vehicle of this.vehicles) {
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
    const escape = this.lanes.find(candidate => candidate.type === 'ESCAPE')!;
    if (lane.type === 'PRINCIPAL' && (action === 'block' || action === 'redirect' || action === 'escape')) this.escapeSourceId = lane.id;
    if (action === 'release') lane.status = 'open';
    if (action === 'block') lane.status = 'blocked';
    if (action === 'reverse') {
      const directionLane = lane.type === 'ESCAPE' ? this.lanes.find(candidate => candidate.id === this.escapeSourceId)! : lane;
      directionLane.direction = directionLane.direction === directionLane.normalDirection ? -directionLane.normalDirection as 1 | -1 : directionLane.normalDirection;
      directionLane.arrows.children.forEach(marker => { (marker as Mesh).rotation.z = directionLane.direction === 1 ? 0 : Math.PI; });
      this.vehicles.filter(vehicle => vehicle.lane === directionLane).forEach(vehicle => { vehicle.mesh.rotation.y = directionLane.direction === 1 ? 0 : Math.PI; });
    }
    if (action === 'escape') {
      const opening = escape.status !== 'open';
      escape.status = opening ? 'open' : 'blocked';
      this.redirecting = opening;
    }
    if (action === 'redirect') this.redirecting = !this.redirecting;
    this.lanes.forEach(candidate => this.syncLaneVisual(candidate));
    this.publishRoadState();
  }

  private removeCone(cone: ConeObstacle): void {
    cone.lane.coneGroup.remove(cone.mesh);
    cone.mesh.clear();
    const index = this.cones.indexOf(cone);
    if (index >= 0) this.cones.splice(index, 1);
  }

  toggleRunning(): boolean {
    this.running = !this.running;
    if (!this.running) this.vehicles.forEach(vehicle => { vehicle.speed = 0; });
    this.publishRoadState();
    return this.running;
  }

  setPedestrianCrossingState(requested: boolean, occupied: boolean): void {
    this.pedestrianCrossingRequested = requested;
    this.pedestrianCrossingOccupied = occupied;
  }

  getPedestrianSignalPhase(): 'green' | 'yellow' | 'red' { return this.crossingSignalPhase; }

  isPedestrianCrossingClear(): boolean {
    if (this.crossingSignalPhase !== 'red') return false;
    return this.vehicles.every(vehicle => {
      const distance = this.distanceToPoint(vehicle.mesh.position.x, this.pedestrianCrossingX, vehicle.lane.direction);
      if (distance > CROSSING_SAFE_DISTANCE) return true;
      return vehicle.speed <= 0.12 && distance >= CROSSING_STOP_DISTANCE - 0.15;
    });
  }

  private updateCrossingSignal(dt: number): void {
    if (this.pedestrianCrossingRequested || this.pedestrianCrossingOccupied) {
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
    this.demandLevel = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.demandClock * Math.PI * 2 / 55 - Math.PI / 6));
    for (const lane of this.lanes) {
      if (lane.type !== 'PRINCIPAL') continue;
      const remaining = (this.spawnTimers.get(lane.id) ?? 2) - dt;
      this.spawnTimers.set(lane.id, remaining);
      if (remaining > 0 || !this.trySpawnVehicle(lane)) continue;
      const interval = 5.3 - this.demandLevel * 3.5 + this.randomTraffic() * 0.55;
      this.spawnTimers.set(lane.id, interval);
    }
  }

  private trySpawnVehicle(lane: Lane): boolean {
    if (this.vehicles.filter(vehicle => vehicle.lane === lane).length >= MAX_VEHICLES_PER_LANE) return false;
    const entryX = lane.direction === 1 ? this.minX + VEHICLE_LENGTH / 2 : this.minX + this.width - VEHICLE_LENGTH / 2;
    const entryIsClear = this.vehicles.every(vehicle => {
      if (Math.abs(vehicle.mesh.position.z - lane.z) >= 0.73) return true;
      return Math.abs(vehicle.mesh.position.x - entryX) >= SAFE_GAP;
    });
    if (!entryIsClear) return false;

    const vehicleIndex = this.vehicles.length;
    const mesh = this.makeVehicle(this.materials[vehicleIndex % this.materials.length]);
    mesh.position.set(entryX, 0.27, lane.z);
    mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
    this.group.add(mesh);
    const maxSpeed = 1.6 + this.randomTraffic() * 0.7;
    this.vehicles.push({ mesh, lane, homeLane: lane, preferredLane: lane, speed: 0, maxSpeed, laneChangeFromZ: lane.z, laneChangeElapsed: LANE_CHANGE_DURATION, plannedConnectionId: null });
    return true;
  }

  private randomTraffic(): number {
    this.trafficRandomSeed = (this.trafficRandomSeed * 16807) % 2147483647;
    return (this.trafficRandomSeed - 1) / 2147483646;
  }

  private removeVehicle(vehicle: Vehicle): void {
    this.group.remove(vehicle.mesh);
    vehicle.mesh.clear();
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) this.vehicles.splice(index, 1);
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05);
    this.updateCrossingSignal(dt);
    this.updateTrafficGeneration(dt);
    for (const vehicle of [...this.vehicles]) {
      const connectionDistance = this.updateRouteDecision(vehicle);
      const obstructionDistance = this.distanceToCone(vehicle);
      const ahead = this.distanceToVehicleAhead(vehicle);
      const gap = ahead - VEHICLE_LENGTH;
      const following = MathUtils.clamp((gap - 1.4) / (SAFE_GAP - 1.4), 0, 1);
      const coneAhead = obstructionDistance <= CONE_LOOKAHEAD;
      if (coneAhead || vehicle.lane.status === 'blocked') this.tryChangeLane(vehicle, coneAhead);
      else this.tryReturnToPreferredLane(vehicle);
      const coneBrake = Number.isFinite(obstructionDistance)
        ? MathUtils.clamp((obstructionDistance - CONE_STOP_DISTANCE) / (CONE_LOOKAHEAD - CONE_STOP_DISTANCE), 0, 1) : 1;
      const crossingDistance = this.distanceToPoint(vehicle.mesh.position.x, this.pedestrianCrossingX, vehicle.lane.direction);
      const clearingCrosswalk = crossingDistance <= CROSSING_CLEARING_DISTANCE;
      const crossingBrake = this.crossingSignalPhase !== 'green' && !clearingCrosswalk
        ? this.getCrossingBrake(vehicle) : 1;
      const atCrossingStopLine = this.crossingSignalPhase !== 'green' && !clearingCrosswalk
        && crossingDistance <= CROSSING_STOP_DISTANCE;
      const approachingConnection = connectionDistance !== null && connectionDistance <= CONNECTION_APPROACH_DISTANCE;
      const connectionBrake = approachingConnection && vehicle.laneChangeElapsed >= LANE_CHANGE_DURATION ? 0 : 1;
      const mayLeaveBlockedLane = vehicle.plannedConnectionId !== null;
      const mayExitClosedEscape = vehicle.lane.type === 'ESCAPE' && vehicle.homeLane !== vehicle.lane;
      const laneAvailable = vehicle.lane.status === 'open' || mayLeaveBlockedLane || mayExitClosedEscape;
      let targetSpeed = this.running && laneAvailable ? vehicle.maxSpeed * following * coneBrake * connectionBrake * crossingBrake : 0;
      if (gap <= MIN_BUMPER_GAP) targetSpeed = 0;
      const stoppedAtCone = Number.isFinite(obstructionDistance) && obstructionDistance <= CONE_STOP_DISTANCE;
      vehicle.speed = atCrossingStopLine || gap <= MIN_BUMPER_GAP || stoppedAtCone ? 0 : MathUtils.damp(vehicle.speed, targetSpeed, 3.5, dt);
      const travel = Math.min(vehicle.speed * dt, Math.max(0, gap - MIN_BUMPER_GAP));
      vehicle.mesh.position.x += vehicle.lane.direction * travel;
      if (vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) {
        vehicle.laneChangeElapsed = Math.min(LANE_CHANGE_DURATION, vehicle.laneChangeElapsed + dt);
        const progress = vehicle.laneChangeElapsed / LANE_CHANGE_DURATION;
        const smoothProgress = progress * progress * (3 - 2 * progress);
        vehicle.mesh.position.z = MathUtils.lerp(vehicle.laneChangeFromZ, vehicle.lane.z, smoothProgress);
      } else {
        vehicle.mesh.position.z = vehicle.lane.z;
      }
      if ((vehicle.lane.direction === 1 && vehicle.mesh.position.x > this.minX + this.width + VEHICLE_LENGTH / 2)
        || (vehicle.lane.direction === -1 && vehicle.mesh.position.x < this.minX - VEHICLE_LENGTH / 2)) {
        this.removeVehicle(vehicle);
      }
    }
    this.publishRoadState();
  }

  private getCrossingBrake(vehicle: Vehicle): number {
    const distance = this.distanceToPoint(vehicle.mesh.position.x, this.pedestrianCrossingX, vehicle.lane.direction);
    if (distance >= CROSSING_BRAKE_DISTANCE) return 1;
    return MathUtils.clamp((distance - CROSSING_STOP_DISTANCE) / (CROSSING_BRAKE_DISTANCE - CROSSING_STOP_DISTANCE), 0, 1);
  }

  private updateRouteDecision(vehicle: Vehicle): number | null {
    if (vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) return null;
    const escape = this.lanes.find(lane => lane.type === 'ESCAPE')!;
    if (vehicle.plannedConnectionId && escape.status !== 'open') vehicle.plannedConnectionId = null;

    if (vehicle.lane.type === 'ESCAPE') {
      const connection = this.connections.find(item => item.role === 'EXIT'
        && item.fromLaneId === escape.id && item.toLaneId === vehicle.homeLane.id
        && item.direction === escape.direction);
      if (!connection) return null;
      const distance = this.distanceToPoint(vehicle.mesh.position.x, connection.x, connection.direction);
      if (distance <= CONNECTION_APPROACH_DISTANCE && vehicle.laneChangeElapsed >= LANE_CHANGE_DURATION
        && this.hasSafeSpaceAt(vehicle.homeLane, connection.x, connection.direction, vehicle)) {
        this.startLaneTransition(vehicle, vehicle.homeLane);
      }
      return distance;
    }

    let connection = this.connections.find(item => item.role === 'ENTRY'
      && item.fromLaneId === vehicle.lane.id && item.direction === vehicle.lane.direction);
    if (!connection) return null;
    const distance = this.distanceToPoint(vehicle.mesh.position.x, connection.x, connection.direction);
    if (!vehicle.plannedConnectionId && distance <= ROUTE_LOOKAHEAD && this.shouldUseEscape(vehicle, escape)) {
      vehicle.plannedConnectionId = connection.id;
      const users = this.vehicles.filter(other => other.lane === escape || other.plannedConnectionId !== null);
      if (users.length === 0) {
        escape.direction = vehicle.lane.direction;
        this.syncLaneVisual(escape);
        vehicle.mesh.rotation.y = escape.direction === 1 ? 0 : Math.PI;
      }
    }
    if (!vehicle.plannedConnectionId) return null;
    if (vehicle.plannedConnectionId) {
      connection = this.connections.find(item => item.id === vehicle.plannedConnectionId) ?? connection;
      const escapeHasCapacity = this.vehicles.filter(other => other.lane === escape || other.plannedConnectionId !== null).length
        <= Math.max(1, Math.floor(escape.capacity / 15));
      const safeGap = this.hasSafeSpaceAt(escape, connection.x, connection.direction, vehicle);
      if (distance <= CONNECTION_APPROACH_DISTANCE && vehicle.laneChangeElapsed >= LANE_CHANGE_DURATION && escapeHasCapacity && safeGap) {
        vehicle.homeLane = vehicle.lane;
        this.startLaneTransition(vehicle, escape);
        vehicle.plannedConnectionId = null;
      }
    }
    return distance;
  }

  private shouldUseEscape(vehicle: Vehicle, escape: Lane): boolean {
    if (escape.status !== 'open') return false;
    const escapeUsers = this.vehicles.filter(other => other.lane === escape || other.plannedConnectionId !== null);
    if (escapeUsers.length >= Math.max(1, Math.floor(escape.capacity / 15))) return false;
    if (escapeUsers.some(other => {
      const reservedDirection = other.plannedConnectionId
        ? this.connections.find(connection => connection.id === other.plannedConnectionId)?.direction
        : other.lane === escape ? escape.direction : undefined;
      return reservedDirection !== undefined && reservedDirection !== vehicle.lane.direction;
    })) return false;
    return vehicle.lane.status === 'blocked'
      || (this.redirecting && vehicle.lane.id === this.escapeSourceId)
      || this.getLaneCongestion(vehicle.lane) >= ROUTE_DECISION_THRESHOLD;
  }

  private startLaneTransition(vehicle: Vehicle, target: Lane): void {
    vehicle.laneChangeFromZ = vehicle.mesh.position.z;
    vehicle.laneChangeElapsed = 0;
    vehicle.lane = target;
  }

  private tryReturnToPreferredLane(vehicle: Vehicle): void {
    const preferred = vehicle.preferredLane;
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

  private distanceToPoint(fromX: number, toX: number, direction: 1 | -1): number {
    const delta = direction === 1 ? toX - fromX : fromX - toX;
    return (delta + this.width) % this.width;
  }

  private getLaneCongestion(lane: Lane): number {
    const vehicles = this.vehicles.filter(vehicle => vehicle.lane === lane);
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
      && Math.abs(lane.z - vehicle.lane.z) <= 0.9
      && lane.direction === vehicle.lane.direction && !this.hasConeNearLane(lane, vehicle.mesh.position.x, LANE_CHANGE_LOOKAHEAD) && lane.status === 'open');
    const target = compatible
      .filter(lane => this.vehicles.filter(other => other !== vehicle && other.lane === lane)
        .every(other => this.directionalDistance(vehicle, other) > SAFE_GAP && this.directionalDistance(other, vehicle) > VEHICLE_LENGTH + 1.4))
      .sort((a, b) => Math.abs(a.z - vehicle.lane.z) - Math.abs(b.z - vehicle.lane.z))[0];
    if (!target) return;
    vehicle.laneChangeFromZ = vehicle.mesh.position.z;
    vehicle.laneChangeElapsed = 0;
    vehicle.lane = target;
    vehicle.plannedConnectionId = null;
  }

  private directionalDistance(from: Vehicle, to: Vehicle): number {
    const raw = to.mesh.position.x - from.mesh.position.x;
    return from.lane.direction === 1 ? (raw + this.width) % this.width : (-raw + this.width) % this.width;
  }

  private distanceToVehicleAhead(vehicle: Vehicle): number {
    let nearest = this.width;
    for (const other of this.vehicles) {
      if (other === vehicle) continue;
      const lateralOverlap = Math.abs(other.mesh.position.z - vehicle.mesh.position.z) < 0.73;
      if (other.lane !== vehicle.lane && !lateralOverlap) continue;
      const distance = (other.mesh.position.x - vehicle.mesh.position.x) * vehicle.lane.direction;
      if (distance > 0.001) nearest = Math.min(nearest, distance);
    }
    return nearest;
  }

  private makeVehicle(bodyMaterial: MeshStandardMaterial): Group {
    const vehicle = new Group();
    vehicle.name = 'traffic-vehicle';
    const body = new Mesh(this.bodyGeometry, bodyMaterial);
    body.castShadow = true; body.receiveShadow = true; vehicle.add(body);
    const cabin = new Mesh(this.cabinGeometry, bodyMaterial);
    cabin.position.set(-0.08, 0.29, 0); cabin.castShadow = true; vehicle.add(cabin);
    for (const x of [-0.42, 0.42]) for (const z of [-0.26, 0.26]) {
      const wheel = new Mesh(this.wheelGeometry, this.dark);
      wheel.rotation.x = Math.PI / 2; wheel.position.set(x, -0.13, z); vehicle.add(wheel);
    }
    return vehicle;
  }

  private publishRoadState(): void { suburbanGameState.setRoads(this.getRoadStates()); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    [this.bodyGeometry, this.cabinGeometry, this.wheelGeometry, this.roadGeometry, this.connectorGeometry, this.barrierGeometry, this.coneGeometry, this.directionGeometry].forEach(geometry => geometry.dispose());
    [...this.materials, this.dark, this.roadMaterial, this.connectorMaterial, this.barrierMaterial, this.directionMaterial, this.escapeDirectionMaterial, this.blockedDirectionMaterial].forEach(material => material.dispose());
    this.group.clear();
    suburbanGameState.setRoads(this.getRoadStates().map(road => ({ ...road, vehicleCount: 0, congestion: 0, status: 'open' })));
  }
}
