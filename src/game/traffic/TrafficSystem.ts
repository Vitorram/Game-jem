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
  coneZoneId: string | null;
};
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
export type MobilityRoadAction = 'release' | 'block' | 'reverse' | 'escape' | 'redirect' | 'placeCones' | 'removeCones';
export type WorkZoneReadiness = {
  prepared: boolean;
  reason: 'NEEDS_INTERVENTION' | 'WAITING_FOR_DIVERSION' | 'CARS_IN_WORK_ZONE' | 'ACCESS_TOO_NARROW' | null;
  nearbyVehicles: number;
};

const VEHICLE_COUNT_PER_LANE = 4;
const VEHICLE_LENGTH = 1.35;
const SAFE_GAP = 4.2;
const LANE_CHANGE_DURATION = 0.7;
const MIN_LANE_CHANGE_DISTANCE = 2.6;
const LANE_CHANGE_LOOKAHEAD = 9;
const ROUTE_DECISION_THRESHOLD = 0.38;
const ROUTE_LOOKAHEAD = 8;
const CONNECTION_APPROACH_DISTANCE = 1.8;
const ESCAPE_CAPACITY = 30;
const CONE_ZONE_STARTS: Record<string, number> = { A: -11.6, B: -5.5, C: 0 };
const CONE_ZONE_LENGTH = 5.2;
const WORK_ZONE_CLEARANCE = 2.9;
const CROSSING_STOP_DISTANCE = 1.35;
const CROSSING_BRAKE_DISTANCE = 5.5;
const CROSSING_SAFE_DISTANCE = 2.5;

/** Fluxo de tráfego de protótipo em duas vias principais e uma via de escape paralela. */
export class TrafficSystem {
  readonly group = new Group();
  private readonly bodyGeometry = new BoxGeometry(VEHICLE_LENGTH, 0.36, 0.72);
  private readonly cabinGeometry = new BoxGeometry(0.62, 0.3, 0.58);
  private readonly wheelGeometry = new CylinderGeometry(0.14, 0.14, 0.08, 10);
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
    const escapeRoadZ = mainRoadZ - map.tileSize;
    this.lanes = [
      this.createLane('orla-eastbound', 1, mainRoadZ - 0.72, 'PRINCIPAL', 100, 1),
      this.createLane('orla-eastbound-2', 1, mainRoadZ - 0.24, 'PRINCIPAL', 100, 1),
      this.createLane('orla-westbound', -1, mainRoadZ + 0.24, 'PRINCIPAL', 100, 1),
      this.createLane('orla-westbound-2', -1, mainRoadZ + 0.72, 'PRINCIPAL', 100, 1),
      this.createLane('orla-escape', 1, escapeRoadZ, 'ESCAPE', ESCAPE_CAPACITY, 0, 'blocked'),
    ];
    this.connections = this.createConnections();
    this.createEscapeConnectors(mainRoadZ, escapeRoadZ);
    let vehicleIndex = 0;
    this.lanes.forEach((lane, laneIndex) => {
      if (lane.type === 'ESCAPE') return;
      for (let index = 0; index < VEHICLE_COUNT_PER_LANE / 2; index++) {
        const material = this.materials[(vehicleIndex + laneIndex) % this.materials.length];
        const mesh = this.makeVehicle(material);
        const start = this.minX + this.width * (vehicleIndex + 0.5) / 8;
        mesh.position.set(start, 0.27, lane.z);
        mesh.rotation.y = lane.direction === 1 ? 0 : Math.PI;
        this.group.add(mesh);
        const maxSpeed = 1.6 + ((vehicleIndex + laneIndex) % 3) * 0.35;
        this.vehicles.push({ mesh, lane, homeLane: lane, preferredLane: lane, speed: maxSpeed, maxSpeed, laneChangeFromZ: lane.z, laneChangeElapsed: LANE_CHANGE_DURATION, plannedConnectionId: null });
        vehicleIndex++;
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
    const lane: Lane = { id, direction, normalDirection: direction, z, type, capacity, priority, status: initialStatus, arrows, barriers, coneGroup, coneZoneId: null };
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
        conesActive: lane.coneZoneId !== null,
        coneZoneId: lane.coneZoneId,
      };
    });
  }

  getWorkZoneReadiness(position: { x: number; z: number }): WorkZoneReadiness {
    const principalLanes = this.lanes.filter(lane => lane.type === 'PRINCIPAL');
    const workLane = principalLanes.reduce((nearest, lane) => Math.abs(lane.z - position.z) < Math.abs(nearest.z - position.z) ? lane : nearest);
    const approachSpace = Math.abs(workLane.z - position.z) - this.bodyGeometry.parameters.depth / 2;
    const escape = this.lanes.find(lane => lane.type === 'ESCAPE')!;
    const escapeOpen = escape.status === 'open';
    const zoneStart = CONE_ZONE_STARTS.A;
    const coneIntervention = workLane.coneZoneId === 'A'
      && position.x >= zoneStart && position.x <= zoneStart + CONE_ZONE_LENGTH;
    const escapeIntervention = escape.status === 'open'
      && this.vehicles.some(vehicle => vehicle.lane === escape && vehicle.homeLane.direction === workLane.direction);
    const nearbyVehicles = this.vehicles.filter(vehicle =>
      Math.hypot(vehicle.mesh.position.x - position.x, vehicle.mesh.position.z - position.z) <= WORK_ZONE_CLEARANCE).length;
    const vehiclesRespectingCones = !coneIntervention || !this.vehicles.some(vehicle => vehicle.lane === workLane
      && this.positionInConeZone(vehicle.mesh.position.x, workLane.coneZoneId));
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

  applyMobilityAction(roadId: string, action: MobilityRoadAction, coneZoneId?: string): void {
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
    if (action === 'placeCones' && coneZoneId) this.placeCones(roadId, coneZoneId);
    if (action === 'removeCones') this.removeCones(lane);
    this.lanes.forEach(candidate => this.syncLaneVisual(candidate));
    this.publishRoadState();
  }

  placeCones(roadId: string, zoneId: string): void {
    const lane = this.lanes.find(candidate => candidate.id === roadId && candidate.type === 'PRINCIPAL');
    if (!lane || !(zoneId in CONE_ZONE_STARTS)) return;
    this.removeCones(lane);
    lane.coneZoneId = zoneId;
    const start = CONE_ZONE_STARTS[zoneId];
    for (let i = 0; i < 6; i++) {
      const cone = new Mesh(this.coneGeometry, this.barrierMaterial);
      cone.position.set(start + i * (CONE_ZONE_LENGTH / 5), 0.31, lane.z);
      cone.castShadow = true;
      lane.coneGroup.add(cone);
    }
    this.publishRoadState();
  }

  private removeCones(lane: Lane): void {
    lane.coneZoneId = null;
    lane.coneGroup.clear();
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

  isPedestrianCrossingClear(): boolean {
    return this.vehicles.every(vehicle => {
      const distance = this.distanceToPoint(vehicle.mesh.position.x, this.pedestrianCrossingX, vehicle.lane.direction);
      if (distance > CROSSING_SAFE_DISTANCE) return true;
      return vehicle.speed <= 0.12 && distance >= 0.7;
    });
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05);
    for (const vehicle of this.vehicles) {
      const connectionDistance = this.updateRouteDecision(vehicle);
      const obstructionDistance = this.distanceToConeZone(vehicle);
      const ahead = this.distanceToVehicleAhead(vehicle);
      const gap = ahead - VEHICLE_LENGTH;
      const following = MathUtils.clamp((gap - 1.4) / (SAFE_GAP - 1.4), 0, 1);
      const insideCones = this.positionInConeZone(vehicle.mesh.position.x, vehicle.lane.coneZoneId);
      if ((obstructionDistance >= MIN_LANE_CHANGE_DISTANCE && obstructionDistance <= LANE_CHANGE_LOOKAHEAD) || insideCones) this.tryChangeLane(vehicle);
      else this.tryReturnToPreferredLane(vehicle);
      const coneBrake = obstructionDistance >= 0 ? MathUtils.clamp((obstructionDistance - 0.6) / 4.5, 0, 1) : 1;
      const crossingBrake = this.pedestrianCrossingRequested || this.pedestrianCrossingOccupied
        ? this.getCrossingBrake(vehicle) : 1;
      const crossingDistance = this.distanceToPoint(vehicle.mesh.position.x, this.pedestrianCrossingX, vehicle.lane.direction);
      const atCrossingStopLine = (this.pedestrianCrossingRequested || this.pedestrianCrossingOccupied)
        && crossingDistance <= CROSSING_STOP_DISTANCE;
      const approachingConnection = connectionDistance !== null && connectionDistance <= CONNECTION_APPROACH_DISTANCE;
      const connectionBrake = approachingConnection && vehicle.laneChangeElapsed >= LANE_CHANGE_DURATION ? 0 : 1;
      const mayLeaveBlockedLane = vehicle.plannedConnectionId !== null;
      const mayExitClosedEscape = vehicle.lane.type === 'ESCAPE' && vehicle.homeLane !== vehicle.lane;
      const laneAvailable = vehicle.lane.status === 'open' || mayLeaveBlockedLane || mayExitClosedEscape;
      const targetSpeed = this.running && laneAvailable ? vehicle.maxSpeed * following * coneBrake * connectionBrake * crossingBrake : 0;
      vehicle.speed = atCrossingStopLine ? 0 : MathUtils.damp(vehicle.speed, targetSpeed, 3.5, dt);
      vehicle.mesh.position.x += vehicle.lane.direction * vehicle.speed * dt;
      if (vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) {
        vehicle.laneChangeElapsed = Math.min(LANE_CHANGE_DURATION, vehicle.laneChangeElapsed + dt);
        const progress = vehicle.laneChangeElapsed / LANE_CHANGE_DURATION;
        const smoothProgress = progress * progress * (3 - 2 * progress);
        vehicle.mesh.position.z = MathUtils.lerp(vehicle.laneChangeFromZ, vehicle.lane.z, smoothProgress);
      } else {
        vehicle.mesh.position.z = vehicle.lane.z;
      }
      if (vehicle.mesh.position.x > this.minX + this.width) vehicle.mesh.position.x -= this.width;
      else if (vehicle.mesh.position.x < this.minX) vehicle.mesh.position.x += this.width;
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
      || preferred.coneZoneId !== null || preferred.direction !== vehicle.lane.direction
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
    return lane.coneZoneId ? Math.round(lane.capacity * 0.6) : lane.capacity;
  }

  private distanceToConeZone(vehicle: Vehicle): number {
    const zoneId = vehicle.lane.coneZoneId;
    if (!zoneId) return Infinity;
    const start = CONE_ZONE_STARTS[zoneId];
    const position = vehicle.mesh.position.x;
    if (this.positionInConeZone(position, zoneId)) return 0;
    const entry = vehicle.lane.direction === 1 ? start : start + CONE_ZONE_LENGTH;
    const raw = entry - vehicle.mesh.position.x;
    return vehicle.lane.direction === 1 ? (raw + this.width) % this.width : (-raw + this.width) % this.width;
  }

  private positionInConeZone(x: number, zoneId: string | null): boolean {
    if (!zoneId) return false;
    const start = CONE_ZONE_STARTS[zoneId];
    return start !== undefined && x >= start && x <= start + CONE_ZONE_LENGTH;
  }

  private tryChangeLane(vehicle: Vehicle): void {
    if (vehicle.lane.coneZoneId === null || vehicle.laneChangeElapsed < LANE_CHANGE_DURATION) return;
    const compatible = this.lanes.filter(lane => lane.type === 'PRINCIPAL' && lane !== vehicle.lane
      && Math.abs(lane.z - vehicle.lane.z) <= 0.5
      && lane.direction === vehicle.lane.direction && lane.coneZoneId === null && lane.status === 'open');
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
      if (other === vehicle || other.lane !== vehicle.lane) continue;
      const raw = other.mesh.position.x - vehicle.mesh.position.x;
      const distance = vehicle.lane.direction === 1 ? (raw + this.width) % this.width : (-raw + this.width) % this.width;
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
    for (const x of [-0.42, 0.42]) for (const z of [-0.37, 0.37]) {
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
