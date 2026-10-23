import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, RingGeometry, SphereGeometry, Sprite, SpriteMaterial } from 'three';
import { suburbanGameState, type UrbanProblem } from '../core/GameState';
import type { Player } from '../entities/Player';
import type { GridMap } from '../map/GridMap';
import type { ItemInteractions } from '../items/ItemInteractions';
import type { TrafficSystem, MobilityRoadAction } from '../traffic/TrafficSystem';
import type { ActiveMobilitySystem } from '../traffic/ActiveMobilitySystem';
import type { BrokenPoleMarker } from '../problems/BrokenPoleMarker';
import { ORLA_EVENTS, ORLA_RECOVERY_MS } from '../session/orlaEvents';
import type { RepairPuzzleType } from '../session/repairPuzzleTypes';
import { VehicleModels } from '../traffic/VehicleModels';

type Point = { x: number; z: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

/** Agenda, intervenções e consequências da fase. O relógio pertence à GameSession. */
export class OrlaPhase {
  readonly group = new Group();
  private elapsedMs = 0;
  private eventIndex = 0;
  private dispatchStartedAt: number | null = null;
  private readonly completedSteps = new Set<number>();
  private crossingBaseline = 0;
  private crossingProtected = false;
  private signalRepairCompleted = false;
  private rescueProtected = false;
  private rushFlowSeconds = 0;
  private service: { id: string; elapsed: number } | null = null;
  isServicing(player: Player): boolean {
    const problem = this.service ? this.problem(this.service.id) : undefined;
    return !!problem && player.id === 1 && distance(player.position, this.serviceTarget(problem)) <= 1.6;
  }
  private readonly ringGeometry = new RingGeometry(0.62, 0.8, 32);
  private readonly boxGeometry = new BoxGeometry(0.45, 0.65, 0.3);
  private readonly antennaGeometry = new CylinderGeometry(0.025, 0.025, 0.6, 6);
  private readonly warningMaterial = new MeshStandardMaterial({ color: '#ffbe46', emissive: '#9e4a00', emissiveIntensity: 0.6, side: 2 });
  private readonly sensorMaterial = new MeshStandardMaterial({ color: '#69dfb0', emissive: '#175c46', emissiveIntensity: 0.6 });
  private readonly markerMaterials: MeshStandardMaterial[] = [];
  private readonly markers = new Map<string, Mesh>();
  private readonly sensor = new Group();
  private readonly signalFx = new Group();
  private readonly signalSparks: Mesh[] = [];
  private readonly signalBubble: Sprite | null;
  private readonly crash = new Group();
  private readonly crashModels = new VehicleModels();
  private readonly crashBubble: Sprite | null;
  private readonly rescueBubble: Sprite | null;
  private rescueBubbleUntilMs = 0;
  private readonly smoke: Mesh[] = [];
  private readonly smokeMaterial = new MeshStandardMaterial({ color: '#b7c0c1', transparent: true, opacity: .52, roughness: 1 });
  private readonly smokeGeometry = new SphereGeometry(.24, 10, 8);
  private cinematic: { x: number; z: number; focusY: number; elapsed: number; duration: number } | null = null;

  constructor(
    private readonly map: GridMap,
    private readonly traffic: TrafficSystem,
    private readonly pedestrians: ActiveMobilitySystem,
    private readonly items: ItemInteractions,
    private readonly pole: BrokenPoleMarker,
    private readonly openRepair: (type: RepairPuzzleType) => void,
    private readonly onStep: (id: string, step: number) => void,
  ) {
    suburbanGameState.setProblems([]);
    suburbanGameState.selectProblem(null);
    this.traffic.resetTutorialInterventions();
    this.traffic.setScheduledDemand(0.2);
    this.items.consume(2, 'cone');
    this.pole.setPhaseState('healthy', 0);
    for (const event of ORLA_EVENTS) {
      if (event.id === 'broken-light-pole-1') continue;
      const material = this.warningMaterial.clone();
      this.markerMaterials.push(material);
      const ring = new Mesh(this.ringGeometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(event.position.x, 0.06, event.position.z);
      ring.visible = false;
      this.markers.set(event.id, ring);
      this.group.add(ring);
    }
    const sensorPosition = ORLA_EVENTS.find(event => event.id === 'sensor-failure')!.position;
    this.sensor.position.set(sensorPosition.x, 0, sensorPosition.z + 0.88);
    const box = new Mesh(this.boxGeometry, this.sensorMaterial);
    box.position.y = 0.4;
    const antenna = new Mesh(this.antennaGeometry, this.sensorMaterial);
    antenna.position.y = 1;
    this.sensor.add(box, antenna);
    this.group.add(this.sensor);
    this.signalFx.position.set(0, 2.9, 4.7);
    const sparkMaterial = new MeshStandardMaterial({ color: '#fff2a3', emissive: '#ff8a22', emissiveIntensity: 2.4 });
    const sparkGeometry = new BoxGeometry(.055, .42, .055);
    for (let i = 0; i < 5; i++) {
      const spark = new Mesh(sparkGeometry, sparkMaterial);
      spark.position.set(Math.cos(i * 1.25) * .42, Math.sin(i * 1.25) * .36, .12);
      spark.rotation.z = i * .83;
      this.signalFx.add(spark); this.signalSparks.push(spark);
    }
    this.signalBubble = this.createSignalBubble();
    if (this.signalBubble) { this.signalBubble.position.set(0, 1.25, .08); this.signalFx.add(this.signalBubble); }
    this.signalFx.visible = false;
    this.group.add(this.signalFx);

    const secondCar = this.crashModels.create('sedan', '#577f9d');
    // O carro parado da TrafficSystem é o primeiro veículo da batida; este
    // segundo, atravessado de leve, completa a cena sem criar um terceiro carro.
    secondCar.group.position.set(.92, 0, .3); secondCar.group.rotation.y = Math.PI / 2 - .2;
    this.crash.add(secondCar.group);
    this.crashBubble = this.createBubble('BATIDA LEVE');
    if (this.crashBubble) { this.crashBubble.position.set(0, 2.8, 0); this.crashBubble.scale.set(3.3, .95, 1); this.crash.add(this.crashBubble); }
    this.rescueBubble = this.createBubble('VOCÊ AJUDOU UM TRABALHADOR!');
    if (this.rescueBubble) { this.rescueBubble.visible = false; this.rescueBubble.scale.set(4.7, 1.35, 1); this.group.add(this.rescueBubble); }
    for (let i = 0; i < 4; i++) {
      const puff = new Mesh(this.smokeGeometry, this.smokeMaterial);
      puff.position.set(i % 2 ? .72 : -.52, 1.1 + (i % 2) * .24, i < 2 ? -.12 : .43);
      this.crash.add(puff); this.smoke.push(puff);
    }
    this.crash.position.set(10, 0, 8.2); this.crash.visible = false;
    this.group.add(this.crash);
    this.publishMetrics();
  }

  teamDispatched(): void {
    const event = ORLA_EVENTS[this.eventIndex];
    const problem = event && this.problem(event.id);
    if (!event || !problem || problem.status === 'RESOLVED'
      || !event.teams.every(team => problem.dispatchedTeams.includes(team))) return;
    if (this.dispatchStartedAt === null) {
      this.dispatchStartedAt = this.elapsedMs;
      this.patch(event.id, { instruction: event.warning, startedAtMs: this.elapsedMs });
    }
  }

  archiveResolved(id: string): boolean {
    const event = ORLA_EVENTS[this.eventIndex];
    const problem = event && this.problem(event.id);
    if (!event || event.id !== id || problem?.status !== 'RESOLVED') return false;
    suburbanGameState.setProblems(suburbanGameState.snapshot().problems.filter(item => item.id !== id));
    suburbanGameState.selectProblem(null);
    this.eventIndex++;
    this.dispatchStartedAt = null;
    this.issueNext();
    return true;
  }

  private issueNext(): void {
    const event = ORLA_EVENTS[this.eventIndex];
    if (!event || this.elapsedMs < event.atMs || suburbanGameState.snapshot().problems.length > 0) return;
    suburbanGameState.setProblems([{ id: event.id,
      type: event.id === 'broken-light-pole-1' ? 'broken-light-pole' : event.id,
      label: event.title, position: { ...event.position }, status: 'ACTIVE', stage: 'warning',
      requiredTeams: [...event.teams], dispatchedTeams: [],
      instruction: 'Novo chamado recebido. Analista: confira o relatório e acione a equipe indicada.' }]);
    suburbanGameState.selectProblem(null);
    if (event.id === 'traffic-signal-failure') {
      // A falha provoca a fila e para os carros imediatamente; as equipes podem
      // ser acionadas enquanto o grupo se reúne na calçada.
      this.pedestrians.setCrossingIncident(true);
      this.pedestrians.setRoadBatchHold(true);
      this.traffic.setUnsafeCrossing(true);
      this.traffic.setSignalFailure(true);
      this.beginCinematic(event.position, 2.05, 2.1);
    }
    if (event.id === 'cyclist-assist') {
      this.pedestrians.beginWorkerRescue();
      this.beginCinematic(event.position, .85, 2.5);
    }
  }

  advance(elapsedMs: number): void {
    this.elapsedMs = elapsedMs;
    this.issueNext();
    const event = ORLA_EVENTS[this.eventIndex];
    const active = event && this.problem(event.id);
    if (event && active && active.stage === 'warning' && this.dispatchStartedAt !== null
      && elapsedMs >= this.dispatchStartedAt + event.warningMs) {
      this.patch(event.id, { stage: 'active', instruction: event.instruction });
      if (event.id === 'minor-collision') {
        this.traffic.warnCollision();
        this.traffic.startCollision();
        const position = this.traffic.getIncidentPosition();
        if (position) { this.patch(event.id, { position }); this.beginCinematic(position, .62); }
      }
    }
    const rush = this.problem('rush-hour');
    const rushDemand = rush && rush.stage === 'active' && rush.status !== 'RESOLVED'
      ? Math.min(1, 0.35 + (elapsedMs - (rush.startedAtMs ?? elapsedMs)) / 18_000) : 0.2;
    this.traffic.setScheduledDemand(rushDemand);
    this.publishMetrics();
  }

  private beginCinematic(point: Point, focusY: number, duration = 3.4): void {
    this.cinematic = { x: point.x, z: point.z, focusY, elapsed: 0, duration };
  }

  getCinematicShot(): { x: number; z: number; focusY: number; progress: number } | null {
    if (!this.cinematic) return null;
    return { x: this.cinematic.x, z: this.cinematic.z, focusY: this.cinematic.focusY,
      progress: Math.min(1, this.cinematic.elapsed / this.cinematic.duration) };
  }

  isCinematicActive(): boolean { return this.cinematic !== null; }

  update(dt: number, player: Player): void {
    if (this.cinematic) {
      this.cinematic.elapsed += dt;
      if (this.cinematic.elapsed >= this.cinematic.duration) this.cinematic = null;
    }
    const crossing = this.problem('traffic-signal-failure');
    const progress = this.pedestrians.getCrossingProgress();
    if (crossing?.stage === 'active' && crossing.status !== 'RESOLVED' && this.crossingProtected
      && progress.crossed >= this.crossingBaseline + 3 && !progress.occupied) {
      this.step(crossing.id, 201);
      // O reparo pode terminar antes da travessia. Reporte os passos na ordem
      // da missão assim que ambos estiverem prontos, independentemente da ordem real.
      if (this.signalRepairCompleted) this.step(crossing.id, 601);
      this.pedestrians.setRoadBatchHold(true);
      this.patch(crossing.id, { instruction: this.crossingInstruction() });
    }
    const rescue = this.problem('cyclist-assist');
    if (rescue?.stage === 'active' && rescue.status === 'ACTIVE'
      && this.pedestrians.getWorkerRescueState() === 'crossing' && !this.completedSteps.has(701)) {
      this.step(rescue.id, 701);
      this.patch(rescue.id, { instruction: 'O entregador está atravessando devagar. Mantenha os carros parados e aguarde ele chegar à calçada.' });
    }
    if (this.rescueBubble && this.elapsedMs >= this.rescueBubbleUntilMs) this.rescueBubble.visible = false;
    const rush = this.problem('rush-hour');
    if (rush?.stage === 'active' && rush.status === 'ACTIVE') {
      const roads = this.traffic.getRoadStates();
      const flowing = roads.filter(road => road.type === 'PRINCIPAL').every(road => road.status === 'open')
        && roads.some(road => road.type === 'ESCAPE' && road.status === 'open') && !this.traffic.isCrossingGuarded()
        && this.traffic.getMovingVehicleCount() > 0;
      this.rushFlowSeconds = flowing ? this.rushFlowSeconds + dt : 0;
      this.patch(rush.id, { instruction: flowing
        ? `Desvio aberto. Mantenha as faixas livres: ${Math.min(8, Math.floor(this.rushFlowSeconds))}/8 s.`
      : ORLA_EVENTS.find(event => event.id === 'rush-hour')!.instruction });
      if (this.rushFlowSeconds >= 8 && !this.completedSteps.has(301)) this.resolve(rush.id, 301);
    }
    const collision = this.problem('minor-collision');
    if (collision?.stage === 'active' && collision.status === 'ACTIVE' && this.traffic.isIncidentProtected()) {
      this.step(collision.id, 501);
      if (!this.service) this.patch(collision.id, { instruction: 'Trecho isolado e desvio aberto. Infraestrutura: use E junto ao veículo para liberar a faixa.' });
    }
    if (this.service) {
      const problem = this.problem(this.service.id);
      const safe = problem && player.id === 1 && distance(player.position, this.serviceTarget(problem)) <= 1.6
        && (problem.id !== 'minor-collision' || this.traffic.isIncidentProtected());
      if (safe && problem) {
        this.service.elapsed += dt;
        const duration = problem.id === 'sensor-failure' ? 1.25 : 1.5;
        this.patch(problem.id, { instruction: `${problem.id === 'sensor-failure' ? 'Instalando sensor' : 'Liberando veículo'}: ${Math.min(100, Math.floor(this.service.elapsed / duration * 100))}%. Permaneça no local.` });
        if (this.service.elapsed >= duration) {
          this.patch(problem.id, { instruction: problem.id === 'sensor-failure'
            ? 'Sensor preparado. Calibre o equipamento.' : 'Veículo isolado. Reconecte os sistemas para liberar a faixa.' });
          this.openRepair(problem.id === 'sensor-failure' ? 'sensor' : 'car');
          this.service = null;
        }
      } else if (problem) {
        this.patch(problem.id, { status: 'ACTIVE' });
        this.patch(problem.id, { instruction: 'Serviço pausado. Retorne com Infraestrutura e mantenha a área protegida para continuar.' });
      }
    }
    this.updateVisuals();
    this.publishMetrics();
  }

  interact(player: Player): void {
    if (player.id === 3) {
      const state = suburbanGameState.snapshot();
      const problem = state.problems.find(item => item.id === state.selectedProblemId && item.status !== 'RESOLVED')
        ?? state.problems.find(item => item.status !== 'RESOLVED');
      if (problem) {
        suburbanGameState.selectProblem(problem.id);
        if (!problem.analyzed) { suburbanGameState.analyzeProblem(problem.id); return; }
        for (const team of problem.requiredTeams ?? []) suburbanGameState.dispatchTeam(problem.id, team);
        this.teamDispatched();
      }
      return;
    }
    if (player.id === 2) {
      const position = player.position;
      const bikeTask = suburbanGameState.snapshot().problems.find(problem =>
        ['cyclist-assist', 'bike-lane-cleanup'].includes(problem.id)
        && problem.stage === 'active' && problem.status === 'ACTIVE'
        && distance(position, problem.position) <= 1.8);
      if (bikeTask) {
        if (bikeTask.id === 'cyclist-assist') return;
        this.resolve(bikeTask.id, 802);
        this.patch(bikeTask.id, { instruction: 'Objeto removido. A ciclovia está livre novamente.' });
        return;
      }
      const crate = this.map.cellCenter(this.map.itemSources[0].column, this.map.itemSources[0].row);
      const held = this.items.heldBy(2);
      // Distância física evita depender do texto ou da célula de orientação do tutorial.
      if (distance(position, crate) <= 2.3) {
        if (held === 'cone') this.items.consume(2, 'cone');
        else this.items.give(2, 'cone');
        return;
      }
      if (held === null && this.traffic.removeNearestCone(position.x, position.z)) {
        this.items.give(2, 'cone');
        return;
      }
      const target = this.traffic.getIncidentConeTarget();
      if (held === 'cone' && target && distance(position, target) <= 1.8) {
        const roadId = this.traffic.getNearbyLane(target.x, target.z);
        if (roadId && this.traffic.placeConeAt(roadId, target.x)) this.items.consume(2, 'cone');
      }
      return;
    }
    const nearby = suburbanGameState.snapshot().problems.filter(problem => problem.stage === 'active'
      && problem.status === 'ACTIVE' && problem.requiredTeams?.includes('infraestrutura')
      && distance(player.position, this.serviceTarget(problem)) <= 1.6)
      .sort((a, b) => distance(player.position, this.serviceTarget(a)) - distance(player.position, this.serviceTarget(b)))[0];
    if (!nearby || this.service) return;
    if (nearby.id === 'broken-light-pole-1') {
      this.patch(nearby.id, { status: 'MAINTENANCE' });
      this.openRepair('pole');
    } else if (nearby.id === 'sensor-failure') {
      this.beginService(nearby.id);
    } else if (nearby.id === 'traffic-signal-failure') {
      this.patch(nearby.id, { status: 'MAINTENANCE' });
      this.openRepair('signal');
    } else if (nearby.id === 'signal-check') {
      this.patch(nearby.id, { status: 'MAINTENANCE', instruction: 'Controlador aberto. Compare os tempos e rode o teste de sincronismo.' });
      this.openRepair('signal-check');
    } else if (nearby.id === 'minor-collision' && this.traffic.isIncidentProtected()) {
      this.beginService(nearby.id);
    }
  }

  completeRepair(): void {
    const problem = this.problem('broken-light-pole-1');
    if (problem?.status === 'MAINTENANCE') this.resolve(problem.id, 101);
  }

  completePuzzle(type: RepairPuzzleType): void {
    const targets: Partial<Record<RepairPuzzleType, { id: string; step: number }>> = {
      signal: { id: 'traffic-signal-failure', step: 601 },
      sensor: { id: 'sensor-failure', step: 401 },
      car: { id: 'minor-collision', step: 502 },
      'signal-check': { id: 'signal-check', step: 801 },
    };
    const target = targets[type];
    if (!target) return;
    if (this.problem(target.id)?.status !== 'MAINTENANCE') return;
    if (type === 'signal') {
      this.signalRepairCompleted = true;
      const signal = this.problem(target.id);
      if (signal && this.completedSteps.has(201)) this.step(signal.id, target.step);
      if (signal) this.patch(signal.id, { instruction: this.crossingInstruction() });
      return;
    }
    if (type === 'car') this.traffic.clearCollision();
    this.resolve(target.id, target.step);
  }

  mobilityAction(player: Player, action: MobilityRoadAction): boolean {
    if (player.id !== 2) return false;
    const rescue = this.problem('cyclist-assist');
    const rescueActive = !!rescue && rescue.stage === 'active' && rescue.status !== 'RESOLVED';
    if (rescueActive && rescue) {
      if (distance(player.position, rescue.position) > 4) return true;
      const roadId = this.traffic.getNearbyLane(player.position.x, player.position.z)
        ?? (player.position.z >= 4 ? 'orla-eastbound' : null);
      if (!roadId) return true;
      if (action === 'blockAll' && !this.rescueProtected) {
        this.traffic.applyMobilityAction(roadId, 'release');
        this.traffic.setCrossingGuarded(true);
        this.rescueProtected = true;
        this.pedestrians.startWorkerCrossing();
        this.patch(rescue.id, { instruction: 'Trânsito retido. Aguarde o entregador atravessar com a bicicleta.' });
        return true;
      }
      if (action === 'release') {
        const workerPosition = this.pedestrians.getWorkerRescuePosition();
        if (this.completedSteps.has(701) && this.pedestrians.getWorkerRescueState() === 'safe' && workerPosition) {
          this.traffic.setCrossingGuarded(false);
          this.traffic.setAssistedCrossingRequested(false);
          this.traffic.applyMobilityAction(roadId, 'release');
          this.resolve(rescue.id, 702);
          if (this.rescueBubble) {
            this.rescueBubble.position.set(workerPosition.x, 2.25, workerPosition.z);
            this.rescueBubble.visible = true;
            this.rescueBubbleUntilMs = this.elapsedMs + 4_200;
          }
          this.beginCinematic(workerPosition, .8, 4.2);
        }
        return true;
      }
      return true;
    }
    const crossing = this.problem('traffic-signal-failure');
    const crossingActive = !!crossing && crossing.status !== 'RESOLVED' && crossing.stage === 'active';
    if (crossingActive && distance(player.position, crossing.position) > 4) return true;
    const roadId = this.traffic.getNearbyLane(player.position.x, player.position.z)
      ?? (player.position.z >= 4 ? 'orla-eastbound' : null);
    if (!roadId) return false;
    if (crossingActive && crossing) {
      if (action === 'blockAll') {
        if (this.completedSteps.has(201)) return true;
        if (!this.crossingProtected) this.crossingBaseline = this.pedestrians.getCrossingProgress().crossed;
        this.crossingProtected = true;
        this.traffic.applyMobilityAction(roadId, 'release');
        this.traffic.setCrossingGuarded(true);
        this.pedestrians.setRoadBatchHold(false);
        return true;
      }
      if (action === 'release') {
        const progress = this.pedestrians.getCrossingProgress();
        if (this.completedSteps.has(201) && this.completedSteps.has(601) && !progress.occupied) {
          this.traffic.setCrossingGuarded(false);
          this.traffic.setUnsafeCrossing(false); this.pedestrians.setCrossingIncident(false);
          this.pedestrians.setRoadBatchHold(false); this.crossingProtected = false;
          this.traffic.applyMobilityAction(roadId, 'release');
          this.resolve(crossing.id, 202);
        } else if (crossing.status !== 'RESOLVED') {
          this.patch(crossing.id, { instruction: this.crossingInstruction() });
        }
        return true;
      }
      return true;
    }
    if (action === 'release') {
      this.traffic.setCrossingGuarded(false);
      this.crossingProtected = false;
    }
    this.traffic.applyMobilityAction(roadId === 'orla-escape' ? 'orla-eastbound' : roadId, action);
    return true;
  }

  canSelectPlayer(id: number): boolean {
    if (id !== 1) return true;
    const rescue = this.problem('cyclist-assist');
    if (rescue && rescue.status !== 'RESOLVED') return false;
    const crossing = this.problem('traffic-signal-failure');
    if (!crossing || crossing.status === 'RESOLVED') return true;
    const progress = this.pedestrians.getCrossingProgress();
    // Infraestrutura só entra depois que a Mobilidade protegeu a faixa e o
    // primeiro grupo realmente começou a atravessar.
    return this.crossingProtected && (progress.occupied || this.completedSteps.has(201));
  }

  guidance(player: Player): { target: Point | null; prompt: string | null } {
    const problem = this.objective(player);
    const held = this.items.heldBy(2) === 'cone';
    const crate = this.map.cellCenter(this.map.itemSources[0].column, this.map.itemSources[0].row);
    const crossing = player.id === 2 ? this.problem('traffic-signal-failure') : undefined;
    if (crossing?.stage === 'active' && crossing.status !== 'RESOLVED' && distance(player.position, crossing.position) <= 4) {
      const progress = this.pedestrians.getCrossingProgress();
      const crossed = this.completedSteps.has(201);
      const repaired = this.completedSteps.has(601);
      const prompt = !this.crossingProtected ? 'USE 3 PARA PARAR OS CARROS E PROTEGER A FAIXA'
        : progress.occupied ? 'PEDESTRES NA FAIXA · AGORA TROQUE PARA INFRA'
          : crossed && repaired ? 'TRAVESSIA E REPARO OK · USE 1 PARA LIBERAR A VIA'
          : crossed ? 'PEDESTRES PASSARAM · AGUARDE O REPARO DO SEMÁFORO'
            : repaired ? 'SEMÁFORO REPARADO · AGUARDE O GRUPO ATRAVESSAR'
              : 'TRAVESSIA SEGURA · AGUARDE O GRUPO ATRAVESSAR';
      return { target: this.targetFor(player, problem), prompt };
    }
    const bikeTask = player.id === 2 ? suburbanGameState.snapshot().problems.find(item =>
      ['cyclist-assist', 'bike-lane-cleanup'].includes(item.id) && item.status === 'ACTIVE') : undefined;
    if (bikeTask && distance(player.position, bikeTask.position) <= (bikeTask.id === 'cyclist-assist' ? 4 : 1.8)) {
      if (bikeTask.id === 'cyclist-assist') {
        const state = this.pedestrians.getWorkerRescueState();
        const prompt = !this.rescueProtected ? 'USE 3 PARA PARAR O TRÂNSITO E PROTEGER A TRAVESSIA'
          : state === 'crossing' ? 'ENTREGADOR ATRAVESSANDO · AGUARDE NA FAIXA'
            : state === 'safe' ? 'ENTREGADOR NA CALÇADA · USE 1 PARA LIBERAR A VIA'
              : 'TRÂNSITO PARADO · AGUARDE A TRAVESSIA SEGURA';
        return { target: this.targetFor(player, problem), prompt };
      }
      return { target: this.targetFor(player, problem), prompt: 'LIBERAR CICLOVIA' };
    }
    if (player.id === 2 && distance(player.position, crate) <= 2.3) {
      return { target: this.targetFor(player, problem), prompt: held ? 'GUARDAR CONE NO BAÚ' : 'PEGAR CONE DO BAÚ' };
    }
    if (player.id === 2 && !held && this.traffic.getNearbyCone(player.position.x, player.position.z)) {
      return { target: this.targetFor(player, problem), prompt: 'RECOLHER CONE DA VIA' };
    }
    if (player.id === 2 && held && this.traffic.getIncidentConeTarget()
      && distance(player.position, this.traffic.getIncidentConeTarget()!) <= 1.8) {
      return { target: this.targetFor(player, problem), prompt: 'COLOCAR CONE ANTES DO VEÍCULO' };
    }
    const near = player.id === 1 ? suburbanGameState.snapshot().problems.find(item => item.stage === 'active'
      && item.status === 'ACTIVE' && item.requiredTeams?.includes('infraestrutura')
      && distance(player.position, this.serviceTarget(item)) <= 1.6) : null;
    const prompt = near ? near.id === 'broken-light-pole-1' ? 'REPARAR CIRCUITO'
      : near.id === 'sensor-failure' ? 'INSTALAR SENSOR'
        : near.id === 'traffic-signal-failure' ? 'SINCRONIZAR SEMÁFORO'
          : near.id === 'signal-check' ? 'CHECAR SEMÁFORO'
        : this.traffic.isIncidentProtected() ? 'LIBERAR VEÍCULO' : 'AGUARDE CONE E DESVIO DA MOBILIDADE' : null;
    return { target: this.targetFor(player, problem), prompt };
  }

  private objective(player: Player): UrbanProblem | undefined {
    const state = suburbanGameState.snapshot();
    const team = player.id === 1 ? 'infraestrutura' : 'mobilidade';
    const candidates = state.problems.filter(problem => problem.status !== 'RESOLVED' && problem.requiredTeams?.includes(team));
    return candidates.find(problem => problem.id === state.selectedProblemId) ?? candidates[0];
  }

  private targetFor(player: Player, problem?: UrbanProblem): Point | null {
    if (player.id === 3) return null;
    if (player.id === 1) return problem ? this.serviceTarget(problem) : null;
    if (problem?.id === 'minor-collision' && this.traffic.getIncidentPosition()) {
      if (this.traffic.isIncidentProtected()) return problem.position;
      if (!this.items.heldBy(2) && !this.traffic.getNearestConePosition(problem.position)) return this.map.cellCenter(this.map.itemSources[0].column, this.map.itemSources[0].row);
      return this.traffic.getIncidentConeTarget();
    }
    if (problem) return problem.position;
    const cone = this.traffic.getNearestConePosition(player.position);
    return this.items.heldBy(2) === 'cone' ? this.map.cellCenter(this.map.itemSources[0].column, this.map.itemSources[0].row) : cone;
  }

  private serviceTarget(problem: UrbanProblem): Point {
    // Trabalhar ao lado do veículo permite chegar sem atravessar sua colisão física.
    return problem.id === 'minor-collision' ? { x: problem.position.x, z: problem.position.z - 1.1 } : problem.position;
  }

  private beginService(id: string): void {
    this.service = { id, elapsed: 0 };
    this.patch(id, { status: 'MAINTENANCE' });
  }

  private problem(id: string): UrbanProblem | undefined {
    return suburbanGameState.snapshot().problems.find(problem => problem.id === id);
  }

  private crossingInstruction(): string {
    const crossed = this.completedSteps.has(201);
    const repaired = this.signalRepairCompleted;
    if (crossed && repaired) return 'Travessia concluída e semáforo reparado. Mobilidade: use 1 junto à faixa para liberar a via.';
    if (crossed) return 'Pedestres atravessaram. Mantenha a via protegida enquanto Infraestrutura termina o semáforo.';
    if (repaired) return 'Semáforo reparado. Mobilidade: use 3 para proteger a faixa e aguarde o grupo atravessar.';
    return 'Mobilidade: use 3 junto à faixa. Quando os pedestres entrarem na travessia, troque para Infraestrutura e conserte o semáforo. Depois, Mobilidade usa 1 para liberar a via.';
  }

  isSignalFaulty(): boolean {
    const signal = this.problem('traffic-signal-failure');
    return !!signal && signal.status !== 'RESOLVED' && !this.signalRepairCompleted;
  }

  private patch(id: string, patch: Partial<UrbanProblem>): void {
    const problems = suburbanGameState.snapshot().problems;
    const problem = problems.find(item => item.id === id);
    if (!problem || Object.entries(patch).every(([key, value]) => problem[key as keyof UrbanProblem] === value)) return;
    Object.assign(problem, patch);
    suburbanGameState.setProblems(problems);
  }

  private step(id: string, step: number): void {
    if (this.completedSteps.has(step)) return;
    this.completedSteps.add(step);
    this.onStep(id, step);
  }

  private resolve(id: string, step: number): void {
    this.step(id, step);
    this.patch(id, { status: 'RESOLVED', instruction: 'Ocorrência resolvida. Volte ao sistema da Analista para arquivar o relatório e receber XP.' });
  }

  private publishMetrics(): void {
    suburbanGameState.setPhase({ elapsedMs: this.elapsedMs, recovery: this.elapsedMs >= ORLA_RECOVERY_MS,
      waitingPedestrians: this.pedestrians.getCrossingProgress().waiting,
      queuedVehicles: this.traffic.getQueuedVehicleCount() });
  }

  private updateVisuals(): void {
    const pole = this.problem('broken-light-pole-1');
    this.pole.setPhaseState(!pole ? 'healthy' : pole.status === 'RESOLVED' ? 'resolved'
      : pole.stage === 'warning' ? 'warning' : pole.status === 'MAINTENANCE' ? 'repairing' : 'broken', this.elapsedMs);
    for (const [id, marker] of this.markers) {
      const problem = this.problem(id);
      marker.visible = !!problem && problem.status !== 'RESOLVED';
      if (!problem) continue;
      marker.position.set(problem.position.x, 0.06, problem.position.z);
      marker.scale.setScalar(1 + Math.sin(this.elapsedMs / 230) * 0.12);
      (marker.material as MeshStandardMaterial).color.set(problem.stage === 'warning' ? '#ffbe46'
        : this.elapsedMs - (problem.startedAtMs ?? 0) > 35_000 ? '#ff6559' : '#ffc85e');
    }
    const sensor = this.problem('sensor-failure');
    this.sensorMaterial.color.set(!sensor || sensor.status === 'RESOLVED' ? '#69dfb0'
      : sensor.stage === 'warning' && Math.floor(this.elapsedMs / 220) % 2 === 0 ? '#ffc85e' : '#ed675a');
    const signal = this.problem('traffic-signal-failure');
    const signalBroken = !!signal && signal.status !== 'RESOLVED';
    this.traffic.setSignalFailure(signalBroken);
    this.signalFx.visible = signalBroken && !this.signalRepairCompleted;
    this.signalSparks.forEach((spark, index) => {
      const phase = this.elapsedMs / 75 + index * 1.7;
      spark.scale.y = .35 + (Math.sin(phase) + 1) * .52;
      spark.position.x = Math.cos(phase) * (.32 + (index % 2) * .22);
      spark.position.y = Math.sin(phase * .8) * .38;
    });
    const collision = this.problem('minor-collision');
    this.crash.visible = !!collision && collision.status !== 'RESOLVED' && collision.stage === 'active';
    if (collision) this.crash.position.set(collision.position.x, 0, collision.position.z);
    this.smoke.forEach((puff, index) => {
      const phase = this.elapsedMs / 620 + index * 1.57;
      puff.position.y = .9 + ((phase % 1 + 1) % 1) * .9;
      puff.scale.setScalar(.75 + ((Math.sin(phase * 2) + 1) * .22));
      this.smokeMaterial.opacity = .28 + (Math.sin(phase) + 1) * .1;
    });
  }

  private createSignalBubble(): Sprite | null { return this.createBubble('PROBLEMA NO SEMÁFORO!'); }

  private createBubble(message: string): Sprite | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 440; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff8e8'; ctx.strokeStyle = '#6b3024'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.roundRect(7, 7, 426, 105, 28); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(205, 108); ctx.lineTo(220, 125); ctx.lineTo(238, 108); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8f3327'; ctx.font = 'bold 29px Arial'; ctx.textAlign = 'center';
    ctx.fillText(message, 220, 70);
    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new Sprite(material); sprite.scale.set(4.5, 1.3, 1); sprite.renderOrder = 5;
    return sprite;
  }

  dispose(): void {
    this.traffic.setSignalFailure(false);
    this.traffic.setUnsafeCrossing(false);
    this.traffic.setCrossingGuarded(false);
    this.pedestrians.setCrossingIncident(false);
    this.pedestrians.setRoadBatchHold(false);
    this.traffic.setAssistedCrossingRequested(false);
    this.ringGeometry.dispose(); this.boxGeometry.dispose(); this.antennaGeometry.dispose();
    this.warningMaterial.dispose(); this.sensorMaterial.dispose();
    this.markerMaterials.forEach(material => material.dispose());
    this.signalFx.traverse(object => { if (object instanceof Mesh) (object.material as MeshStandardMaterial).dispose(); });
    if (this.signalBubble) { (this.signalBubble.material as SpriteMaterial).map?.dispose(); (this.signalBubble.material as SpriteMaterial).dispose(); }
    if (this.crashBubble) { (this.crashBubble.material as SpriteMaterial).map?.dispose(); (this.crashBubble.material as SpriteMaterial).dispose(); }
    if (this.rescueBubble) { (this.rescueBubble.material as SpriteMaterial).map?.dispose(); (this.rescueBubble.material as SpriteMaterial).dispose(); }
    this.crashModels.dispose(); this.smokeGeometry.dispose(); this.smokeMaterial.dispose();
    this.group.clear();
  }
}
