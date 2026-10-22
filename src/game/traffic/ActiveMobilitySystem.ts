import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Group, MathUtils, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type { GridMap } from '../map/GridMap';
import type { TrafficSystem } from './TrafficSystem';

type WalkerState = 'walking' | 'waiting' | 'crossing' | 'walking-south';
type Walker = { mesh: Group; x: number; z: number; speed: number; state: WalkerState; exitDirection: 1 | -1 };
type Cyclist = { mesh: Group; x: number; z: number; speed: number; baseSpeed: number; direction: 1 | -1 };

const CROSSING_X = 1;
const CYCLE_NORTH_Z = 2.58;
const CYCLE_SOUTH_Z = 3.42;
const WALK_Z = 5.15;
const SOUTH_WALK_Z = 10.75;
const SIDEWALK_Y = 0.02;
const CYCLIST_SAFE_GAP = 1.15;
const WALKER_SAFE_GAP = 0.85;

/** Ciclovia bidirecional sinalizada, faixa de pedestres zebrada com rampas e conjunto semafórico sincronizado. */
export class ActiveMobilitySystem {
  readonly group = new Group();
  private readonly cyclists: Cyclist[] = [];
  private readonly walkers: Walker[] = [];
  private readonly minX: number;
  private readonly maxX: number;
  private readonly geometries: BufferGeometry[] = [];
  private readonly boxGeometry = new BoxGeometry(1, 1, 1);
  private readonly cylinderGeometry = new CylinderGeometry(1, 1, 1, 10);
  private readonly sphereGeometry = new SphereGeometry(1, 12, 10);
  private readonly vehicleSignalMaterials = [
    new MeshStandardMaterial({ color: '#e74d42', emissive: '#e74d42', emissiveIntensity: 0.12, roughness: 0.35 }),
    new MeshStandardMaterial({ color: '#f0c747', emissive: '#f0c747', emissiveIntensity: 0.12, roughness: 0.35 }),
    new MeshStandardMaterial({ color: '#57cf7c', emissive: '#57cf7c', emissiveIntensity: 0.12, roughness: 0.35 }),
  ];
  private readonly pedestrianSignalMaterials = [
    new MeshStandardMaterial({ color: '#ff4d42', emissive: '#ff4d42', emissiveIntensity: 0.12, roughness: 0.35 }),
    new MeshStandardMaterial({ color: '#47e678', emissive: '#47e678', emissiveIntensity: 0.12, roughness: 0.35 }),
  ];
  private readonly agentGeometries = [
    new BoxGeometry(0.58, 0.045, 0.045),
    new CylinderGeometry(0.035, 0.035, 0.48, 6),
    new CylinderGeometry(0.035, 0.035, 0.42, 6),
    new TorusGeometry(0.22, 0.035, 6, 14),
    new BoxGeometry(0.23, 0.34, 0.18),
    new SphereGeometry(0.13, 10, 8),
    new CylinderGeometry(0.045, 0.045, 0.42, 6),
    new CylinderGeometry(0.045, 0.045, 0.42, 6),
  ];
  private readonly white = new MeshStandardMaterial({ color: '#f5f2e6', roughness: 0.78 });
  private readonly rampConcrete = new MeshStandardMaterial({ color: '#e2ded4', roughness: 0.84 });
  private readonly tactileYellow = new MeshStandardMaterial({ color: '#f0b832', roughness: 0.72 });
  private readonly poleMetal = new MeshStandardMaterial({ color: '#2b3238', roughness: 0.65 });
  private readonly housingDark = new MeshStandardMaterial({ color: '#1b2024', roughness: 0.75 });
  private readonly pushButtonYellow = new MeshStandardMaterial({ color: '#f2c138', roughness: 0.6 });
  private readonly bikeFrame = new MeshStandardMaterial({ color: '#263b46', roughness: 0.72 });
  private readonly tire = new MeshStandardMaterial({ color: '#25292a', roughness: 0.92 });
  private readonly clothes = ['#d75c50', '#4a8795', '#df9a42', '#577455'].map(color => new MeshStandardMaterial({ color, roughness: 0.8 }));
  private readonly skin = new MeshStandardMaterial({ color: '#d99b70', roughness: 0.85 });
  private spawnCycleTimer = 3.8;
  private spawnWalkerTimer = 6.2;
  private randomSeed = 827;
  private disposed = false;

  constructor(private readonly map: GridMap, private readonly traffic: TrafficSystem) {
    this.group.name = 'cycleway-and-pedestrians';
    this.minX = -map.width / 2 + 1;
    this.maxX = map.width / 2 - 1;
    this.geometries.push(this.boxGeometry, this.cylinderGeometry, this.sphereGeometry, ...this.agentGeometries);

    this.createCrossingAndRamps();
    this.createTrafficSignals();

    for (let i = 0; i < 4; i++) {
      const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
      this.spawnCyclist(this.minX + i * 7.2, dir);
    }
    for (let i = 0; i < 3; i++) {
      this.spawnWalker(this.minX + i * 4.5);
    }
    this.syncTrafficSignal();
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
    const startZ = 6.32;
    const endZ = 9.68;
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
    this.addBox(this.group, 'crosswalk-stop-line-eastbound', this.white, CROSSING_X - 1.52, -0.006, 7.23, 0.2, 0.024, 2.1);
    // Sentido Oeste (Z = 8.52 a 9.84): para antes de X = CROSSING_X + 1.52
    this.addBox(this.group, 'crosswalk-stop-line-westbound', this.white, CROSSING_X + 1.52, -0.006, 9.18, 0.2, 0.024, 1.32);

    // 3. Travessia de pedestres demarcada sobre a ciclovia (Z = 2.24 a 3.76)
    for (let i = 0; i < 4; i++) {
      const z = 2.34 + i * 0.44;
      this.addBox(this.group, `cycleway-crosswalk-stripe-${i + 1}`, this.white, CROSSING_X, -0.001, z, 1.32, 0.014, 0.22);
    }
    // Linhas de parada para bicicletas antes da faixa na ciclovia
    this.addBox(this.group, 'cycleway-stop-west', this.white, CROSSING_X - 0.95, -0.001, 3.0, 0.1, 0.014, 1.62);
    this.addBox(this.group, 'cycleway-stop-east', this.white, CROSSING_X + 0.95, -0.001, 3.0, 0.1, 0.014, 1.62);

    // 4. Rampas de acessibilidade (guias rebaixadas) e piso tátil de alerta (Norte e Sul)
    this.buildAccessibilityRamp('north', CROSSING_X, 5.9, 5.64, 1);
    this.buildAccessibilityRamp('south', CROSSING_X, 10.1, 10.36, -1);

    // Piso tátil na chegada da calçada norte junto à ciclovia
    this.addBox(this.group, 'tactile-cycleway-edge', this.tactileYellow, CROSSING_X, 0.024, 4.16, 1.48, 0.01, 0.22);
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

  private createTrafficSignals(): void {
    // Conjunto semafórico na Calçada Norte (voltado para Leste/Pedestres Sul) e na Calçada Sul (voltado para Oeste/Pedestres Norte)
    this.buildSignalAssembly('north', CROSSING_X + 1.38, 5.62, -1);
    this.buildSignalAssembly('south', CROSSING_X - 1.38, 10.38, 1);
  }

  private buildSignalAssembly(side: 'north' | 'south', x: number, z: number, roadDirZ: 1 | -1): void {
    const assembly = new Group();
    assembly.name = `traffic-signal-assembly-${side}`;

    // Base estrutural e poste vertical principal
    const base = new Mesh(this.cylinderGeometry, this.poleMetal);
    base.scale.set(0.13, 0.18, 0.13);
    base.position.set(x, 0.09, z);
    base.castShadow = true;
    assembly.add(base);

    const pole = new Mesh(this.cylinderGeometry, this.poleMetal);
    pole.scale.set(0.065, 2.35, 0.065);
    pole.position.set(x, 1.18, z);
    pole.castShadow = true;
    assembly.add(pole);

    // Braço horizontal projetado sobre a avenida
    const armZ = z - roadDirZ * 0.55;
    this.addBox(assembly, `signal-arm-${side}`, this.poleMetal, x, 2.24, armZ, 0.07, 0.07, 1.15, true);

    // Caixa semafórica veicular principal (3 focos: Vermelho, Amarelo, Verde)
    const vehHousingZ = z - roadDirZ * 0.98;
    this.addBox(assembly, `vehicle-signal-housing-${side}`, this.housingDark, x, 1.92, vehHousingZ, 0.34, 0.88, 0.26, true);

    const lensDirX = side === 'north' ? -1 : 1;
    this.vehicleSignalMaterials.forEach((material, index) => {
      const y = 2.18 - index * 0.26;
      const bulb = new Mesh(this.sphereGeometry, material);
      bulb.name = `vehicle-signal-bulb-${side}-${index}`;
      bulb.scale.set(0.095, 0.095, 0.095);
      bulb.position.set(x + lensDirX * 0.14, y, vehHousingZ);
      assembly.add(bulb);
    });

    // Caixa semafórica de pedestres na coluna (2 focos: Vermelho Pare / Verde Siga)
    this.addBox(assembly, `pedestrian-signal-housing-${side}`, this.housingDark, x, 1.48, z - roadDirZ * 0.12, 0.26, 0.48, 0.2, true);
    this.pedestrianSignalMaterials.forEach((material, index) => {
      const y = 1.58 - index * 0.2;
      const bulb = new Mesh(this.sphereGeometry, material);
      bulb.name = `pedestrian-signal-bulb-${side}-${index}`;
      bulb.scale.set(0.072, 0.072, 0.072);
      bulb.position.set(x, y, z - roadDirZ * 0.21);
      assembly.add(bulb);
    });

    // Botoeira amarela de pedestres presa ao poste
    this.addBox(assembly, `pedestrian-pushbutton-${side}`, this.pushButtonYellow, x - lensDirX * 0.075, 0.98, z, 0.06, 0.16, 0.09);

    this.group.add(assembly);
  }

  private syncTrafficSignal(): void {
    const vehiclePhase = this.traffic.getPedestrianSignalPhase();
    const activeVehicleIndex = vehiclePhase === 'green' ? 2 : vehiclePhase === 'yellow' ? 1 : 0;
    this.vehicleSignalMaterials.forEach((material, index) => {
      material.emissiveIntensity = index === activeVehicleIndex ? 1.45 : 0.08;
    });

    // Semáforo de pedestres é verde apenas quando o tráfego veicular está vermelho
    const pedestrianGreen = vehiclePhase === 'red';
    this.pedestrianSignalMaterials[0].emissiveIntensity = pedestrianGreen ? 0.08 : 1.4; // Vermelho pedestre
    this.pedestrianSignalMaterials[1].emissiveIntensity = pedestrianGreen ? 1.5 : 0.08; // Verde pedestre
  }

  private spawnCyclist(x: number, direction: 1 | -1 = 1): void {
    if (this.cyclists.length >= 6) return;
    const laneZ = direction === 1 ? CYCLE_SOUTH_Z : CYCLE_NORTH_Z;
    if (this.cyclists.some(c => c.direction === direction && Math.abs(c.x - x) < CYCLIST_SAFE_GAP)) return;
    const mesh = this.makeCyclist(this.cyclists.length);
    const z = laneZ + (this.random() - 0.5) * 0.08;
    mesh.position.set(x, 0, z);
    mesh.rotation.y = direction === 1 ? 0 : Math.PI;
    this.group.add(mesh);
    const speed = 2.0 + this.random() * 0.65;
    this.cyclists.push({ mesh, x, z, speed, baseSpeed: speed, direction });
  }

  private spawnWalker(x: number): void {
    if (this.walkers.length >= 5) return;
    if (this.walkers.some(walker => walker.state === 'walking' && Math.abs(walker.x - x) < WALKER_SAFE_GAP)) return;
    const mesh = this.makeWalker(this.walkers.length);
    const z = WALK_Z + (this.random() - 0.5) * 0.18;
    mesh.position.set(x, SIDEWALK_Y, z);
    this.group.add(mesh);
    const exitDirection: 1 | -1 = this.random() > 0.5 ? 1 : -1;
    this.walkers.push({ mesh, x, z, speed: 0.72 + this.random() * 0.22, state: 'walking', exitDirection });
  }

  update(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05);
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
    this.syncTrafficSignal();
  }

  private moveCyclists(dt: number): void {
    const pedestrianAtCrosswalk = this.walkers.some(w => w.state === 'waiting' || w.state === 'crossing');

    for (const direction of [1, -1] as const) {
      const laneCyclists = this.cyclists
        .filter(c => c.direction === direction)
        .sort((a, b) => direction === 1 ? b.x - a.x : a.x - b.x);

      for (const cyclist of laneCyclists) {
        const ahead = laneCyclists.find(other => other !== cyclist && (direction === 1 ? other.x > cyclist.x : other.x < cyclist.x));
        const gap = ahead ? Math.abs(ahead.x - cyclist.x) : Infinity;
        let targetSpeed = cyclist.baseSpeed;
        if (ahead) targetSpeed *= MathUtils.clamp((gap - CYCLIST_SAFE_GAP) / 1.4, 0, 1);

        // Ciclistas reduzem e param na linha de retenção da ciclovia quando há pedestre atravessando
        if (pedestrianAtCrosswalk) {
          const stopX = direction === 1 ? CROSSING_X - 1.1 : CROSSING_X + 1.1;
          const distToStop = (stopX - cyclist.x) * direction;
          if (distToStop >= -0.15 && distToStop < 2.2) {
            targetSpeed *= MathUtils.clamp(distToStop / 1.8, 0, 1);
            if (distToStop <= 0.18) targetSpeed = 0;
          }
        }

        const nextStep = Math.min(targetSpeed * dt, Math.max(0, gap - CYCLIST_SAFE_GAP));
        const nextCell = this.map.worldToCell({ x: cyclist.x + direction * nextStep, z: cyclist.z });
        if (this.map.tileAt(nextCell.column, nextCell.row) !== 'cycleway') targetSpeed = 0;

        cyclist.speed = MathUtils.damp(cyclist.speed, targetSpeed, 4.5, dt);
        const travel = Math.min(cyclist.speed * dt, Math.max(0, gap - CYCLIST_SAFE_GAP));
        cyclist.x += direction * travel;

        if ((direction === 1 && cyclist.x > this.maxX) || (direction === -1 && cyclist.x < this.minX)) {
          this.group.remove(cyclist.mesh);
          this.disposeAgent(cyclist.mesh);
          this.cyclists.splice(this.cyclists.indexOf(cyclist), 1);
        } else {
          cyclist.mesh.position.x = cyclist.x;
          cyclist.mesh.position.z = cyclist.z;
        }
      }
    }
  }

  private moveWalkers(dt: number): void {
    const frontToBack = [...this.walkers].sort((a, b) => b.x - a.x);
    for (const walker of frontToBack) {
      if (walker.state === 'walking') {
        const ahead = frontToBack.find(other => other !== walker && other.state === 'walking' && other.x > walker.x);
        const gap = ahead ? ahead.x - walker.x : Infinity;
        const following = ahead ? MathUtils.clamp((gap - WALKER_SAFE_GAP) / 1.15, 0, 1) : 1;
        const step = Math.min(walker.speed * following * dt, Math.max(0, gap - WALKER_SAFE_GAP));
        const nextCell = this.map.worldToCell({ x: walker.x + step, z: WALK_Z });
        const nextKind = this.map.tileAt(nextCell.column, nextCell.row);
        if (nextKind === 'cycleway' || nextKind === 'promenade') {
          if (walker.x < CROSSING_X && walker.x + step >= CROSSING_X) {
            walker.x = CROSSING_X;
            walker.z = 5.52;
            walker.state = 'waiting';
          } else {
            walker.x += step;
          }
        }
      }

      const anotherPedestrianCrossing = this.walkers.some(other => other !== walker && other.state === 'crossing');
      if (walker.state === 'waiting' && !anotherPedestrianCrossing && this.traffic.isPedestrianCrossingClear()) {
        walker.state = 'crossing';
      }

      if (walker.state === 'crossing') {
        walker.z += walker.speed * 1.12 * dt;
        if (walker.z >= SOUTH_WALK_Z) {
          walker.z = SOUTH_WALK_Z;
          walker.state = 'walking-south';
        }
      } else if (walker.state === 'walking-south') {
        walker.x += walker.exitDirection * walker.speed * dt;
      }

      const surfaceY = walker.state === 'crossing' && walker.z > 5.95 && walker.z < 10.05 ? 0 : SIDEWALK_Y;
      walker.mesh.position.set(walker.x, surfaceY, walker.state === 'walking' ? WALK_Z : walker.z);
      walker.mesh.rotation.y = walker.state === 'waiting' || walker.state === 'crossing'
        ? 0
        : walker.state === 'walking-south'
          ? (walker.exitDirection === 1 ? Math.PI / 2 : -Math.PI / 2)
          : Math.PI / 2;

      if (walker.state === 'walking-south' && (walker.x < this.minX || walker.x > this.maxX)) {
        this.group.remove(walker.mesh);
        this.disposeAgent(walker.mesh);
        this.walkers.splice(this.walkers.indexOf(walker), 1);
      }
    }

    const waiting = this.walkers.some(walker => walker.state === 'waiting');
    const occupied = this.walkers.some(walker => walker.state === 'crossing');
    this.traffic.setPedestrianCrossingState(waiting || occupied, occupied);
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
    this.geometries.forEach(geometry => geometry.dispose());
    [
      this.white,
      this.rampConcrete,
      this.tactileYellow,
      this.poleMetal,
      this.housingDark,
      this.pushButtonYellow,
      this.bikeFrame,
      this.tire,
      this.skin,
      ...this.clothes,
      ...this.vehicleSignalMaterials,
      ...this.pedestrianSignalMaterials,
    ].forEach(material => material.dispose());
    this.group.clear();
    this.cyclists.length = 0;
    this.walkers.length = 0;
  }
}
