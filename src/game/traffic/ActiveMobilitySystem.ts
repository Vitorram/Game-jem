import {
  BoxGeometry, BufferGeometry, Group, MathUtils, Mesh, MeshStandardMaterial,
} from 'three';
import type { GridMap } from '../map/GridMap';
import { WORK_ZONE_CLEARANCE, type TrafficSystem } from './TrafficSystem';
import { ORLA_CROSSING } from '../config';
import { NpcModels, type NpcVisual } from './NpcModels';
import { CROSSING_RULES, advanceWithRoom } from './crossingRules';

type WalkerState = 'approach-cycle' | 'wait-cycle' | 'cross-cycle' | 'approach-road' | 'wait-road' | 'form-road' | 'cross-road' | 'exit';
type Walker = { slot: number; arrived: number; batchIndex: number; visual: NpcVisual; mesh: Group; x: number; z: number; speed: number; state: WalkerState; exitDirection: 1 | -1 };
type Cyclist = { visual: NpcVisual; mesh: Group; x: number; z: number; speed: number; baseSpeed: number; direction: 1 | -1 };

const CROSSING_X = ORLA_CROSSING.centerX;
const SIDEWALK_Y = 0.02;
const CYCLIST_SAFE_GAP = 1.55;
const WALKER_SAFE_GAP = 0.85;
const CYCLIST_YIELD_LOOKAHEAD = 6;
const CYCLIST_STOP_DISTANCE = 1.05;

/** Travessias independentes para a ciclovia e a avenida, sem semaforos. */
export class ActiveMobilitySystem {
  readonly group = new Group();
  private readonly cyclists: Cyclist[] = [];
  private readonly walkers: Walker[] = [];
  private readonly minX: number;
  private readonly maxX: number;
  private readonly cycleCenterZ: number;
  private readonly cycleNorthZ: number;
  private readonly cycleSouthZ: number;
  private readonly northSidewalkZ: number;
  private readonly roadNorthEdgeZ: number;
  private readonly roadSouthEdgeZ: number;
  private readonly roadQueueZ: number;
  private readonly southWalkZ: number;
  private readonly beachSpawnZ: number;
  private readonly geometries: BufferGeometry[] = [];
  private readonly boxGeometry = new BoxGeometry(1, 1, 1);
  private readonly npcModels = new NpcModels();
  private walkerVariant = 0;
  private cyclistVariant = 0;
  private readonly white = new MeshStandardMaterial({ color: '#f5f2e6', roughness: 0.78 });
  private readonly rampConcrete = new MeshStandardMaterial({ color: '#e2ded4', roughness: 0.84 });
  private readonly tactileYellow = new MeshStandardMaterial({ color: '#f0b832', roughness: 0.72 });
  private spawnCycleTimer = 3.8;
  private spawnWalkerTimer = 6.2;
  private randomSeed = 827;
  private disposed = false;
  private elapsed = 0;
  private roadBatch: Walker[] = [];
  private cycleBatch: Walker | null = null;
  private roadCooldown = 0;
  private cycleCooldown = 0;
  private groupSpeed = .85;
  private playerPosition: { x: number; z: number } | null = null;

  constructor(private readonly map: GridMap, private readonly traffic: TrafficSystem) {
    this.group.name = 'cycleway-and-pedestrians';
    this.minX = -map.width / 2 + 1;
    this.maxX = map.width / 2 - 1;
    const roadRows = Array.from({ length: map.rows }, (_, row) => row)
      .filter(row => Array.from({ length: map.columns }, (_, column) => map.tileAt(column, row)).includes('road'));
    if (roadRows.length === 0 || Math.min(...roadRows) < 3) throw new Error('Mapa da Orla sem espaço para as travessias.');
    const firstRoadRow = Math.min(...roadRows);
    const lastRoadRow = Math.max(...roadRows);
    this.roadNorthEdgeZ = map.cellCenter(0, firstRoadRow).z - map.tileSize / 2;
    this.roadSouthEdgeZ = map.cellCenter(0, lastRoadRow).z + map.tileSize / 2;
    this.northSidewalkZ = map.cellCenter(0, firstRoadRow - 1).z;
    this.cycleCenterZ = map.cellCenter(0, firstRoadRow - 2).z;
    this.cycleNorthZ = this.cycleCenterZ - 0.42;
    this.cycleSouthZ = this.cycleCenterZ + 0.42;
    this.roadQueueZ = this.roadNorthEdgeZ - 0.5;
    this.southWalkZ = this.roadSouthEdgeZ + 0.75;
    this.beachSpawnZ = map.cellCenter(0, firstRoadRow - 3).z + 0.15;
    this.geometries.push(this.boxGeometry);

    this.createCrossingAndRamps();

    for (let i = 0; i < 4; i++) {
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      this.spawnCyclist(this.minX + i * 7.2, dir);
    }
    for (let i = 0; i < 4; i++) {
      this.spawnWalker(this.minX + i * 4.5);
    }
  }

  private addBox(
    parent: Group,
    name: string,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    castShadow = false,
  ): Mesh {
    const mesh = new Mesh(this.boxGeometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private createCrossingAndRamps(): void {
    // 1. Faixa de pedestres zebrada oficial na avenida (barras paralelas ao fluxo dos carros)
    const stripeCount = 9;
    const startZ = this.roadNorthEdgeZ + 0.32;
    const endZ = this.roadSouthEdgeZ - 0.32;
    const stepZ = (endZ - startZ) / (stripeCount - 1);

    for (let i = 0; i < stripeCount; i++) {
      const z = startZ + i * stepZ;
      this.addBox(
        this.group,
        `crosswalk-stripe-${i + 1}`,
        this.white,
        CROSSING_X,
        -0.006,
        z,
        1.58,
        0.024,
        0.26,
      );
    }

    // 2. Linhas de retenção (Stop Lines) antes da faixa para cada sentido da avenida
    // Sentido Leste (Z = 6.18 a 8.28): para antes de X = CROSSING_X - 1.52
    const eastboundStopZ = this.roadSouthEdgeZ - 2.4;
    const westboundStopZ = this.roadSouthEdgeZ - 0.8;
    this.addBox(this.group, 'crosswalk-stop-line-eastbound', this.white, CROSSING_X - 1.52, -0.006, eastboundStopZ, 0.2, 0.024, 1.8);
    // Sentido Oeste (Z = 8.52 a 9.84): para antes de X = CROSSING_X + 1.52
    this.addBox(this.group, 'crosswalk-stop-line-westbound', this.white, CROSSING_X + 1.52, -0.006, westboundStopZ, 0.2, 0.024, 1.8);

    // 3. Travessia de pedestres demarcada sobre a ciclovia (Z = 2.24 a 3.76)
    for (let i = 0; i < 4; i++) {
      const z = this.cycleCenterZ - 0.66 + i * 0.44;
      this.addBox(this.group, `cycleway-crosswalk-stripe-${i + 1}`, this.white, CROSSING_X, -0.001, z, 1.32, 0.014, 0.22);
    }
    // Linhas de parada para bicicletas antes da faixa na ciclovia
    this.addBox(this.group, 'cycleway-stop-west', this.white, CROSSING_X - 0.95, -0.001, this.cycleCenterZ, 0.1, 0.014, 1.62);
    this.addBox(this.group, 'cycleway-stop-east', this.white, CROSSING_X + 0.95, -0.001, this.cycleCenterZ, 0.1, 0.014, 1.62);

    // 4. Rampas de acessibilidade (guias rebaixadas) e piso tátil de alerta (Norte e Sul)
    this.buildAccessibilityRamp('north', CROSSING_X, this.roadNorthEdgeZ - 0.1, this.roadNorthEdgeZ - 0.36, 1);
    this.buildAccessibilityRamp('south', CROSSING_X, this.roadSouthEdgeZ + 0.1, this.roadSouthEdgeZ + 0.36, -1);

    // Piso tátil na chegada da calçada norte junto à ciclovia
    this.addBox(this.group, 'tactile-cycleway-edge', this.tactileYellow, CROSSING_X, 0.024, this.northSidewalkZ - 0.84, 1.48, 0.01, 0.22);
  }

  private buildAccessibilityRamp(side: 'north' | 'south', x: number, curbZ: number, tactileZ: number, dirZ: 1 | -1): void {
    // Rampa central rebaixada substituindo o meio-fio elevado
    this.addBox(this.group, `curb-ramp-slope-${side}`, this.rampConcrete, x, 0.01, curbZ, 1.54, 0.032, 0.26);
    // Abas laterais chanfradas da rampa
    this.addBox(this.group, `curb-ramp-wing-w-${side}`, this.rampConcrete, x - 0.87, 0.025, curbZ, 0.2, 0.048, 0.24);
    this.addBox(this.group, `curb-ramp-wing-e-${side}`, this.rampConcrete, x + 0.87, 0.025, curbZ, 0.2, 0.048, 0.24);

    // Placa base do piso tátil de alerta (amarelo)
    this.addBox(this.group, `tactile-paving-${side}`, this.tactileYellow, x, 0.026, tactileZ, 1.5, 0.012, 0.28);

    // Fileira de domos táteis em relevo
    for (let ix = -3; ix <= 3; ix++) {
      for (const iz of [-0.06, 0.06]) {
        this.addBox(
          this.group,
          `tactile-stud-${side}-${ix}-${iz}`,
          this.tactileYellow,
          x + ix * 0.2,
          0.034,
          tactileZ + iz * dirZ,
          0.07,
          0.008,
          0.07,
        );
      }
    }
  }

  private spawnCyclist(x: number, direction: 1 | -1 = 1): void {
    if (this.cyclists.length >= 6) return;
    const laneZ = direction === 1 ? this.cycleSouthZ : this.cycleNorthZ;
    if (this.cyclists.some(c => c.direction === direction && Math.abs(c.x - x) < CYCLIST_SAFE_GAP)) return;
    const visual = this.npcModels.createCyclist(this.cyclistVariant++);
    const mesh = visual.mesh;
    const z = laneZ + (this.random() - 0.5) * 0.08;
    mesh.position.set(x, 0, z);
    mesh.rotation.y = direction === 1 ? 0 : Math.PI;
    this.group.add(mesh);
    const speed = 2.0 + this.random() * 0.65;
    this.cyclists.push({ visual, mesh, x, z, speed, baseSpeed: speed, direction });
  }

  private spawnWalker(x: number): void {
    if (this.walkers.length >= 6) return;
    const slot = [0, 1, 2, 3, 4, 5].find(value => !this.walkers.some(walker => walker.slot === value))!;
    const fromBeach = this.walkerVariant % 2 === 0;
    const z = fromBeach ? this.beachSpawnZ : this.northSidewalkZ - 0.5;
    if (this.walkers.some(walker => Math.hypot(walker.x - x, walker.z - z) < WALKER_SAFE_GAP)) return;
    const visual = this.npcModels.createWalker(this.walkerVariant++);
    const mesh = visual.mesh;
    mesh.position.set(x, SIDEWALK_Y, z);
    this.group.add(mesh);
    const exitDirection: 1 | -1 = this.random() > .5 ? 1 : -1;
    this.walkers.push({ visual, mesh, slot, arrived: 0, batchIndex: 0, x, z, speed: .72 + this.random() * .22,
      state: fromBeach ? 'approach-cycle' : 'approach-road', exitDirection });
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05);
    this.elapsed += dt;
    this.prepareCrossings(dt);
    this.spawnCycleTimer -= dt;
    if (this.spawnCycleTimer <= 0) {
      const dir: 1 | -1 = this.random() > 0.42 ? 1 : -1;
      const startX = dir === 1 ? this.minX + 0.45 : this.maxX - 0.45;
      this.spawnCyclist(startX, dir);
      this.spawnCycleTimer = 3.8 + this.random() * 3.6;
    }
    this.spawnWalkerTimer -= dt;
    if (this.spawnWalkerTimer <= 0) {
      this.spawnWalker(this.minX + 0.55);
      this.spawnWalkerTimer = 5.5 + this.random() * 5.5;
    }

    this.moveCyclists(dt);
    this.moveWalkers(dt);
  }

  setPlayerPosition(position: { x: number; z: number } | null): void {
    this.playerPosition = position ? { x: position.x, z: position.z } : null;
  }

  getPlayerCollision(position: { x: number; z: number }, radius = 0.34): { x: number; z: number } | null {
    const impact = this.cyclists
      .filter(cyclist => cyclist.speed > 0.8
        && Math.abs(cyclist.x - position.x) <= 0.52 + radius
        && Math.abs(cyclist.z - position.z) <= 0.3 + radius)
      .sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z)
        - Math.hypot(b.x - position.x, b.z - position.z))[0];
    if (!impact) return null;
    return { x: 0, z: position.z >= impact.z ? 1 : -1 };
  }

  countCyclistsInWorkZone(position: { x: number; z: number }): number {
    return this.cyclists.filter(cyclist => {
      const dx = Math.max(0, Math.abs(cyclist.x - position.x) - 0.52);
      const dz = Math.max(0, Math.abs(cyclist.z - position.z) - 0.3);
      return Math.hypot(dx, dz) <= WORK_ZONE_CLEARANCE;
    }).length;
  }

  private prepareCrossings(dt: number): void {
    this.roadCooldown = Math.max(0, this.roadCooldown - dt);
    this.cycleCooldown = Math.max(0, this.cycleCooldown - dt);
    if (!this.cycleBatch && this.cycleCooldown === 0) {
      this.cycleBatch = this.walkers.filter(w => w.state === 'wait-cycle').sort((a, b) => a.arrived - b.arrived)[0] ?? null;
    }
    if (!this.roadBatch.length && this.roadCooldown === 0) {
      const waiting = this.walkers.filter(w => w.state === 'wait-road').sort((a, b) => a.arrived - b.arrived);
      if (waiting.length >= CROSSING_RULES.roadGroupSize) {
        this.roadBatch = waiting.slice(0, CROSSING_RULES.roadGroupSize);
        this.groupSpeed = Math.min(...this.roadBatch.map(w => w.speed)) * 1.12;
        this.roadBatch.forEach((walker, index) => { walker.state = 'form-road'; walker.batchIndex = index; });
      }
    }
    this.publishCrossing();
  }

  private publishCrossing(): void {
    this.traffic.setPedestrianCrossingState(this.roadBatch.length, this.roadBatch.some(w => w.state === 'cross-road'));
  }

  private moveCyclists(dt: number): void {
    for (const direction of [1, -1] as const) {
      const lane = this.cyclists.filter(c => c.direction === direction).sort((a, b) => direction * (b.x - a.x));
      for (let index = 0; index < lane.length; index++) {
        const cyclist = lane[index], ahead = lane[index - 1];
        let room = ahead ? Math.max(0, (ahead.x - cyclist.x) * direction - CYCLIST_SAFE_GAP) : Infinity;
        const distance = (CROSSING_X - cyclist.x) * direction;
        // Quem ja passou da retencao termina de sair; os proximos param antes da faixa.
        if (this.cycleBatch && distance >= CROSSING_RULES.cycleStopDistance - .001) {
          room = Math.min(room, Math.max(0, distance - CROSSING_RULES.cycleStopDistance));
        }
        const playerDistance = this.playerPosition && Math.abs(this.playerPosition.z - cyclist.z) <= 0.82
          ? (this.playerPosition.x - cyclist.x) * direction : Infinity;
        if (playerDistance >= 0 && playerDistance <= CYCLIST_YIELD_LOOKAHEAD) {
          room = Math.min(room, Math.max(0, playerDistance - CYCLIST_STOP_DISTANCE));
        }
        const motion = advanceWithRoom(cyclist.speed, cyclist.baseSpeed, room, dt, 1.5, 3.5);
        cyclist.speed = motion.speed;
        cyclist.x += direction * motion.distance;
        cyclist.visual.animate(dt, motion.distance);
        cyclist.mesh.position.set(cyclist.x, 0, cyclist.z);
        if (cyclist.x > this.maxX || cyclist.x < this.minX) {
          this.group.remove(cyclist.mesh); cyclist.visual.dispose();
          this.cyclists.splice(this.cyclists.indexOf(cyclist), 1);
        }
      }
    }
  }

  private isCycleCrossingClear(): boolean {
    return this.cyclists.every(cyclist => {
      const distance = (CROSSING_X - cyclist.x) * cyclist.direction;
      if (Math.abs(cyclist.x - CROSSING_X) < CROSSING_RULES.cycleConflictHalfWidth) return false;
      return distance < 0 || distance > CROSSING_RULES.cycleApproachDistance || cyclist.speed <= CROSSING_RULES.stoppedSpeed;
    });
  }

  private moveToward(walker: Walker, x: number, z: number, dt: number, speed = walker.speed): boolean {
    const dx = x - walker.x, dz = z - walker.z, distance = Math.hypot(dx, dz);
    const step = Math.min(distance, speed * dt);
    if (distance > .000001) { walker.x += dx / distance * step; walker.z += dz / distance * step; }
    return distance <= step + .000001;
  }

  private moveWalkers(dt: number): void {
    if (this.cycleBatch?.state === 'wait-cycle' && this.isCycleCrossingClear()) this.cycleBatch.state = 'cross-cycle';
    const ready = this.roadBatch.length === CROSSING_RULES.roadGroupSize && this.roadBatch.every(w =>
      w.state === 'form-road' && Math.hypot(w.x - (CROSSING_X + (w.batchIndex - 1) * .48), w.z - this.roadQueueZ) < .001);
    if (ready && this.traffic.isPedestrianCrossingClear()) this.roadBatch.forEach(w => { w.state = 'cross-road'; });

    for (const walker of [...this.walkers]) {
      const oldX = walker.x, oldZ = walker.z;
      const queueX = CROSSING_X + (walker.slot % 3 - 1) * .48;
      switch (walker.state) {
        case 'approach-cycle':
          if (this.moveToward(walker, queueX, this.cycleCenterZ - 1.5 - Math.floor(walker.slot / 3) * .55, dt)) {
            walker.state = 'wait-cycle'; walker.arrived = this.elapsed;
          }
          break;
        case 'cross-cycle':
          // Ajusta X ainda na calcada antes de entrar na ciclovia.
          if (Math.abs(walker.x - CROSSING_X) > .001 && walker.z < 1.8) this.moveToward(walker, CROSSING_X, walker.z, dt);
          else if (this.moveToward(walker, CROSSING_X, this.northSidewalkZ - 0.65, dt)) {
            walker.state = 'approach-road'; this.cycleBatch = null; this.cycleCooldown = CROSSING_RULES.cycleFlowSeconds;
          }
          break;
        case 'approach-road':
          if (this.moveToward(walker, queueX, this.roadQueueZ - Math.floor(walker.slot / 3) * .65, dt)) {
            walker.state = 'wait-road'; walker.arrived = this.elapsed;
          }
          break;
        case 'form-road':
          this.moveToward(walker, CROSSING_X + (walker.batchIndex - 1) * .48, this.roadQueueZ, dt);
          break;
        case 'cross-road':
          if (this.moveToward(walker, walker.x, this.southWalkZ, dt, this.groupSpeed)) walker.state = 'exit';
          break;
        case 'exit':
          walker.x += walker.exitDirection * walker.speed * dt;
          break;
      }
      const dx = walker.x - oldX, dz = walker.z - oldZ, traveled = Math.hypot(dx, dz);
      const heading = traveled > .000001 ? Math.atan2(dx, dz) : 0;
      const turn = Math.atan2(Math.sin(heading - walker.mesh.rotation.y), Math.cos(heading - walker.mesh.rotation.y)) * (1 - Math.exp(-12 * dt));
      walker.mesh.rotation.y += turn;
      const onRoad = walker.z > this.roadNorthEdgeZ && walker.z < this.roadSouthEdgeZ;
      walker.mesh.position.set(walker.x, onRoad ? 0 : SIDEWALK_Y, walker.z);
      walker.visual.animate(dt, traveled, dt > 0 ? turn / dt : 0);
      if (walker.state === 'exit' && (walker.x < this.minX || walker.x > this.maxX)) {
        this.group.remove(walker.mesh); walker.visual.dispose(); this.walkers.splice(this.walkers.indexOf(walker), 1);
      }
    }
    if (this.roadBatch.length && this.roadBatch.every(w => w.state === 'exit')) {
      this.roadBatch = []; this.roadCooldown = CROSSING_RULES.roadFlowSeconds;
    }
    this.publishCrossing();
  }

  private random(): number {
    this.randomSeed = (this.randomSeed * 16807) % 2147483647;
    return (this.randomSeed - 1) / 2147483646;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.traffic.setPedestrianCrossingState(0, false);
    this.walkers.forEach(walker => walker.visual.dispose());
    this.cyclists.forEach(cyclist => cyclist.visual.dispose());
    this.npcModels.dispose();
    this.geometries.forEach(geometry => geometry.dispose());
    [
      this.white,
      this.rampConcrete,
      this.tactileYellow,
    ].forEach(material => material.dispose());
    this.group.clear();
    this.cyclists.length = 0;
    this.walkers.length = 0;
  }
}
