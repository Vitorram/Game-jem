import {
  BoxGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { GridMap } from '../map/GridMap';
import type { TrafficSystem } from './TrafficSystem';

type Walker = {
  mesh: Group;
  x: number;
  z: number;
  speed: number;
  state: 'walking' | 'waiting' | 'aligning' | 'crossing';
  wantsToCross: boolean;
  alignmentStartX?: number;
  alignmentTargetX?: number;
  alignmentElapsed?: number;
};
type Cyclist = { mesh: Group; x: number; z: number; speed: number; baseSpeed: number };

const CROSSING_X = 1;
const CYCLE_Z = 3.05;
const WALK_Z = 5.15;
const CROSSING_END_Z = 9.55;
const CYCLIST_SAFE_GAP = 1.05;
const WALKER_SAFE_GAP = 0.82;
const CROSSING_MERGE_CLEARANCE = 0.85;
const CROSSING_GROUP_THRESHOLD = 4;
const CROSSING_GROUP_X_OFFSETS = [0.63, 0.21, -0.21, -0.63];
const CROSSING_ALIGNMENT_DURATION = 0.8;

/** Ciclovia com tráfego leve e travessia de pedestres simples. */
export class ActiveMobilitySystem {
  readonly group = new Group();
  private readonly cyclists: Cyclist[] = [];
  private readonly walkers: Walker[] = [];
  private readonly minX: number;
  private readonly maxX: number;
  private readonly crossingGeometries: BoxGeometry[] = [];
  private readonly agentGeometries = [
    new BoxGeometry(0.58, 0.045, 0.045), new CylinderGeometry(0.035, 0.035, 0.48, 6),
    new CylinderGeometry(0.035, 0.035, 0.42, 6), new TorusGeometry(0.22, 0.035, 6, 14),
    new BoxGeometry(0.23, 0.34, 0.18), new SphereGeometry(0.13, 10, 8),
    new CylinderGeometry(0.045, 0.045, 0.42, 6), new CylinderGeometry(0.045, 0.045, 0.42, 6),
  ];
  private readonly white = new MeshStandardMaterial({ color: '#f5f1df', roughness: 0.8 });
  private readonly bikeFrame = new MeshStandardMaterial({ color: '#263b46', roughness: 0.72 });
  private readonly tire = new MeshStandardMaterial({ color: '#25292a', roughness: 0.92 });
  private readonly clothes = ['#d75c50', '#4a8795', '#df9a42', '#577455'].map(color => new MeshStandardMaterial({ color, roughness: 0.8 }));
  private readonly skin = new MeshStandardMaterial({ color: '#d99b70', roughness: 0.85 });
  private spawnCycleTimer = 4.5;
  private spawnWalkerTimer = 7;
  private crossingBatchActive = false;
  private randomSeed = 827;
  private disposed = false;

  constructor(private readonly map: GridMap, private readonly traffic: TrafficSystem) {
    this.group.name = 'cycleway-and-pedestrians';
    this.minX = -map.width / 2 + 1;
    this.maxX = map.width / 2 - 1;
    this.createCrossing();
    for (let i = 0; i < 4; i++) this.spawnCyclist(this.minX + i * 7.3);
    for (let i = 0; i < 3; i++) this.spawnWalker(this.minX + i * 4.5);
  }

  private createCrossing(): void {
    for (let i = -2; i <= 2; i++) {
      const geometry = new BoxGeometry(0.28, 0.035, 4.15);
      this.crossingGeometries.push(geometry);
      const stripe = new Mesh(geometry, this.white);
      stripe.name = `crosswalk-stripe-${i + 3}`;
      stripe.position.set(CROSSING_X + i * 0.48, 0.025, 7.95);
      stripe.receiveShadow = true;
      this.group.add(stripe);
    }
  }

  private spawnCyclist(x: number): void {
    if (this.cyclists.length >= 6) return;
    if (this.cyclists.some(cyclist => Math.abs(cyclist.x - x) < CYCLIST_SAFE_GAP)) return;
    const mesh = this.makeCyclist(this.cyclists.length);
    const z = CYCLE_Z + (this.random() - 0.5) * 0.18;
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    const speed = 2 + this.random() * 0.65;
    this.cyclists.push({ mesh, x, z, speed, baseSpeed: speed });
  }

  private spawnWalker(x: number): void {
    if (this.walkers.length >= 5) return;
    if (this.walkers.some(walker => walker.state !== 'crossing' && Math.abs(walker.x - x) < WALKER_SAFE_GAP)) return;
    const mesh = this.makeWalker(this.walkers.length);
    const z = WALK_Z + (this.random() - 0.5) * 0.22;
    mesh.position.set(x, 0, z);
    this.group.add(mesh);
    this.walkers.push({ mesh, x, z, speed: 0.68 + this.random() * 0.22, state: 'walking', wantsToCross: this.random() < 0.78 });
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05);
    this.spawnCycleTimer -= dt;
    if (this.spawnCycleTimer <= 0) {
      this.spawnCyclist(this.minX + 0.45);
      this.spawnCycleTimer = 4.2 + this.random() * 4;
    }
    this.spawnWalkerTimer -= dt;
    if (this.spawnWalkerTimer <= 0) {
      this.spawnWalker(this.minX + 0.55);
      this.spawnWalkerTimer = 6 + this.random() * 6;
    }

    this.moveCyclists(dt);
    this.moveWalkers(dt);
  }

  private moveCyclists(dt: number): void {
    const ordered = [...this.cyclists].sort((a, b) => b.x - a.x);
    for (const cyclist of ordered) {
      const ahead = ordered.find(other => other !== cyclist && other.x > cyclist.x);
      const gap = ahead ? ahead.x - cyclist.x : Infinity;
      let targetSpeed = cyclist.baseSpeed;
      if (ahead) targetSpeed *= MathUtils.clamp((gap - CYCLIST_SAFE_GAP) / 1.4, 0, 1);
      const nextStep = Math.min(targetSpeed * dt, Math.max(0, gap - CYCLIST_SAFE_GAP));
      const nextCell = this.map.worldToCell({ x: cyclist.x + nextStep, z: cyclist.z });
      if (this.map.tileAt(nextCell.column, nextCell.row) !== 'cycleway') targetSpeed = 0;
      cyclist.speed = MathUtils.damp(cyclist.speed, targetSpeed, 4.5, dt);
      cyclist.x += Math.min(cyclist.speed * dt, Math.max(0, gap - CYCLIST_SAFE_GAP));
      if (cyclist.x > this.maxX) {
        this.group.remove(cyclist.mesh);
        this.disposeAgent(cyclist.mesh);
        this.cyclists.splice(this.cyclists.indexOf(cyclist), 1);
      } else {
        cyclist.mesh.position.x = cyclist.x;
        cyclist.mesh.position.z = cyclist.z;
      }
    }
  }

  private moveWalkers(dt: number): void {
    const frontToBack = [...this.walkers].sort((a, b) => b.x - a.x);
    let crossingActive = this.walkers.some(walker => walker.state === 'crossing' || walker.state === 'aligning');
    for (const walker of frontToBack) {
      if (walker.state === 'walking') {
        const ahead = frontToBack.find(other => other !== walker && other.x > walker.x
          && (other.state !== 'crossing' || other.z < WALK_Z + CROSSING_MERGE_CLEARANCE));
        const gap = ahead ? ahead.x - walker.x : Infinity;
        const following = ahead ? MathUtils.clamp((gap - WALKER_SAFE_GAP) / 1.15, 0, 1) : 1;
        const step = Math.min(walker.speed * following * dt, Math.max(0, gap - WALKER_SAFE_GAP));
        const nextCell = this.map.worldToCell({ x: walker.x + step, z: WALK_Z });
        if (this.map.tileAt(nextCell.column, nextCell.row) === 'cycleway') {
          const curbQueue = this.walkers.filter(other => other !== walker
            && (other.state === 'waiting'
            || (other.state === 'crossing' && other.z < WALK_Z + CROSSING_MERGE_CLEARANCE)
            || other.state === 'aligning')
            && other.x > walker.x);
          const queueTargetX = CROSSING_X - 0.18 - (curbQueue.length + 1) * WALKER_SAFE_GAP;
          if (walker.wantsToCross && walker.x < queueTargetX && walker.x + step >= queueTargetX) {
            walker.x = queueTargetX;
            walker.state = 'waiting';
          } else {
            walker.x += step;
          }
        }
      }
      if (walker.state === 'waiting' && !this.walkers.some(other => other.state === 'aligning')) {
        const curbQueue = this.walkers.filter(other => other.state === 'waiting'
          || (other.state === 'crossing' && other.z < WALK_Z + CROSSING_MERGE_CLEARANCE))
          .sort((a, b) => b.x - a.x);
        const queueIndex = curbQueue.indexOf(walker);
        const targetX = CROSSING_X - 0.18 - Math.max(0, queueIndex) * WALKER_SAFE_GAP;
        walker.x += Math.min(walker.speed * dt, Math.max(0, targetX - walker.x));
      }
      if (walker.state === 'aligning') {
        const elapsed = Math.min(CROSSING_ALIGNMENT_DURATION, (walker.alignmentElapsed ?? 0) + dt);
        walker.alignmentElapsed = elapsed;
        const progress = elapsed / CROSSING_ALIGNMENT_DURATION;
        const eased = progress * progress * (3 - 2 * progress);
        walker.x = MathUtils.lerp(walker.alignmentStartX ?? walker.x, walker.alignmentTargetX ?? walker.x, eased);
        if (elapsed >= CROSSING_ALIGNMENT_DURATION) {
          walker.state = 'crossing';
          walker.z = WALK_Z;
        }
      }
      if (walker.state === 'crossing') walker.z += walker.speed * dt;
      walker.mesh.position.set(walker.x, 0, walker.state === 'crossing' ? walker.z : WALK_Z);
      walker.mesh.rotation.y = walker.state === 'crossing' ? 0 : Math.PI / 2;
      if (walker.state === 'crossing' && walker.z >= CROSSING_END_Z) {
        this.group.remove(walker.mesh);
        this.disposeAgent(walker.mesh);
        this.walkers.splice(this.walkers.indexOf(walker), 1);
      }
    }
    const occupied = this.walkers.some(walker => walker.state === 'crossing');
    const waitingGroup = this.walkers.filter(walker => walker.state === 'waiting').sort((a, b) => b.x - a.x);
    const aligning = this.walkers.some(walker => walker.state === 'aligning');
    if (!this.crossingBatchActive && waitingGroup.length >= CROSSING_GROUP_THRESHOLD) {
      this.crossingBatchActive = true;
    }
    if (this.crossingBatchActive && !occupied && !aligning && waitingGroup.length >= CROSSING_GROUP_THRESHOLD
      && this.traffic.isPedestrianCrossingClear()) {
      waitingGroup.slice(0, CROSSING_GROUP_THRESHOLD).forEach((walker, index) => {
        walker.state = 'aligning';
        walker.alignmentStartX = walker.x;
        walker.alignmentTargetX = CROSSING_X + CROSSING_GROUP_X_OFFSETS[index];
        walker.alignmentElapsed = 0;
      });
    }
    if (this.crossingBatchActive && !occupied && !aligning && waitingGroup.length < CROSSING_GROUP_THRESHOLD) {
      this.crossingBatchActive = false;
    }
    // Cars yield only for an assembled group (four waiting pedestrians) or
    // while someone is physically crossing. Others continue along the path.
    this.traffic.setPedestrianCrossingState(this.crossingBatchActive || occupied, occupied);
  }

  private makeCyclist(index: number): Group {
    const cyclist = new Group();
    cyclist.name = 'cycleway-cyclist';
    const wheelsGeo = this.agentGeometries[3];
    const wheelA = new Mesh(wheelsGeo, this.tire);
    wheelA.position.set(-0.22, 0.23, 0);
    const wheelB = new Mesh(wheelsGeo, this.tire);
    wheelB.position.set(0.22, 0.23, 0);
    cyclist.add(wheelA, wheelB);
    this.addRod(cyclist, new Vector3(-0.22, 0.23, 0), new Vector3(0.02, 0.23, 0), 0);
    this.addRod(cyclist, new Vector3(0.02, 0.23, 0), new Vector3(-0.06, 0.49, 0), 1);
    this.addRod(cyclist, new Vector3(-0.06, 0.49, 0), new Vector3(-0.22, 0.23, 0), 2);
    this.addRod(cyclist, new Vector3(-0.06, 0.49, 0), new Vector3(0.22, 0.23, 0), 1);
    this.addRod(cyclist, new Vector3(-0.06, 0.49, 0), new Vector3(0.08, 0.68, 0), 2);
    const torso = new Mesh(this.agentGeometries[4], this.clothes[index % this.clothes.length]);
    torso.position.set(0.01, 0.74, 0);
    const head = new Mesh(this.agentGeometries[5], this.skin);
    head.position.set(0.15, 0.99, 0);
    cyclist.add(torso, head);
    cyclist.traverse(object => { if (object instanceof Mesh) object.castShadow = true; });
    return cyclist;
  }

  private addRod(parent: Group, start: Vector3, end: Vector3, geometryIndex: number): void {
    const rod = new Mesh(this.agentGeometries[geometryIndex], this.bikeFrame);
    rod.position.copy(start).add(end).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.clone().sub(start).normalize());
    parent.add(rod);
  }

  private makeWalker(index: number): Group {
    const walker = new Group();
    walker.name = 'cycleway-pedestrian';
    const body = new Mesh(this.agentGeometries[4], this.clothes[(index + 1) % this.clothes.length]);
    body.position.y = 0.48;
    const head = new Mesh(this.agentGeometries[5], this.skin);
    head.position.y = 0.74;
    const legA = new Mesh(this.agentGeometries[6], this.tire);
    legA.position.set(-0.07, 0.18, 0);
    const legB = new Mesh(this.agentGeometries[7], this.tire);
    legB.position.set(0.07, 0.18, 0);
    walker.add(body, head, legA, legB);
    walker.traverse(object => { if (object instanceof Mesh) object.castShadow = true; });
    return walker;
  }

  private disposeAgent(agent: Group): void {
    agent.clear();
  }

  private random(): number {
    this.randomSeed = (this.randomSeed * 16807) % 2147483647;
    return (this.randomSeed - 1) / 2147483646;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.traffic.setPedestrianCrossingState(false, false);
    this.crossingBatchActive = false;
    this.agentGeometries.forEach(geometry => geometry.dispose());
    this.crossingGeometries.forEach(geometry => geometry.dispose());
    [this.white, this.bikeFrame, this.tire, this.skin, ...this.clothes].forEach(material => material.dispose());
    this.group.clear();
    this.cyclists.length = 0;
    this.walkers.length = 0;
  }
}

