import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, RingGeometry } from 'three';
import { suburbanGameState, type UrbanProblem } from '../core/GameState';
import type { Player } from '../entities/Player';
import type { GridMap } from '../map/GridMap';
import type { ItemInteractions } from '../items/ItemInteractions';
import type { TrafficSystem, MobilityRoadAction } from '../traffic/TrafficSystem';
import type { ActiveMobilitySystem } from '../traffic/ActiveMobilitySystem';
import type { BrokenPoleMarker } from '../problems/BrokenPoleMarker';
import { ORLA_EVENTS, ORLA_RECOVERY_MS } from '../session/orlaEvents';
import type { RepairPuzzleType } from '../session/repairPuzzleTypes';

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
  }

  advance(elapsedMs: number): void {
    this.elapsedMs = elapsedMs;
    this.issueNext();
    const event = ORLA_EVENTS[this.eventIndex];
    const active = event && this.problem(event.id);
    if (event && active && active.stage === 'warning' && this.dispatchStartedAt !== null
      && elapsedMs >= this.dispatchStartedAt + event.warningMs) {
      this.patch(event.id, { stage: 'active', instruction: event.instruction });
      if (event.id === 'unsafe-crossing') {
        this.pedestrians.setCrossingIncident(true);
        this.traffic.setUnsafeCrossing(true);
      }
      if (event.id === 'minor-collision') {
        this.traffic.warnCollision();
        this.traffic.startCollision();
        const position = this.traffic.getIncidentPosition();
        if (position) this.patch(event.id, { position });
      }
    }
    const rush = this.problem('rush-hour');
    const rushDemand = rush && rush.stage === 'active' && rush.status !== 'RESOLVED'
      ? Math.min(1, 0.35 + (elapsedMs - (rush.startedAtMs ?? elapsedMs)) / 18_000) : 0.2;
    this.traffic.setScheduledDemand(rushDemand);
    this.publishMetrics();
  }

  update(dt: number, player: Player): void {
    const crossing = this.problem('unsafe-crossing');
    const progress = this.pedestrians.getCrossingProgress();
    if (crossing?.stage === 'active' && crossing.status !== 'RESOLVED' && this.crossingProtected
      && progress.crossed >= this.crossingBaseline + 3 && !progress.occupied) {
      this.step(crossing.id, 201);
      this.pedestrians.setRoadBatchHold(true);
      this.patch(crossing.id, { instruction: 'Grupo atravessou! Mobilidade: use 1 junto à faixa para liberar os carros.' });
    }
    const rush = this.problem('rush-hour');
    if (rush?.stage === 'active' && rush.status !== 'RESOLVED') {
      const roads = this.traffic.getRoadStates();
      const flowing = roads.filter(road => road.type === 'PRINCIPAL').every(road => road.status === 'open')
        && roads.some(road => road.type === 'ESCAPE' && road.status === 'open') && !this.traffic.isCrossingGuarded()
        && this.traffic.getMovingVehicleCount() > 0;
      this.rushFlowSeconds = flowing ? this.rushFlowSeconds + dt : 0;
      this.patch(rush.id, { instruction: flowing
        ? `Desvio aberto. Mantenha as faixas livres: ${Math.min(8, Math.floor(this.rushFlowSeconds))}/8 s.`
        : ORLA_EVENTS[2].instruction });
      if (this.rushFlowSeconds >= 8 && rush.status !== 'MAINTENANCE' && !this.completedSteps.has(301)) { this.patch(rush.id, { status: 'MAINTENANCE' }); this.openRepair('traffic'); }
    }
    const collision = this.problem('minor-collision');
    if (collision?.stage === 'active' && collision.status !== 'RESOLVED' && this.traffic.isIncidentProtected()) {
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
      && problem.status !== 'RESOLVED' && problem.requiredTeams?.includes('infraestrutura')
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
      traffic: { id: 'rush-hour', step: 301 },
    };
    if (type === 'crossing') {
      const problem = this.problem('unsafe-crossing');
      if (problem?.status !== 'MAINTENANCE') return;
      this.resolve(problem.id, 202);
      this.traffic.setUnsafeCrossing(false); this.pedestrians.setCrossingIncident(false);
      this.pedestrians.setRoadBatchHold(false); this.crossingProtected = false;
      return;
    }
    const target = targets[type];
    if (!target) return;
    if (type === 'car') this.traffic.clearCollision();
    this.resolve(target.id, target.step);
  }

  mobilityAction(player: Player, action: MobilityRoadAction): boolean {
    if (player.id !== 2) return false;
    const roadId = this.traffic.getNearbyLane(player.position.x, player.position.z)
      ?? (player.position.z >= 4 ? 'orla-eastbound' : null);
    if (!roadId) return false;
    const crossing = this.problem('unsafe-crossing');
    if (crossing && crossing.status !== 'RESOLVED' && crossing.stage === 'active'
      && distance(player.position, crossing.position) <= 4) {
      if (action === 'blockAll') {
        if (!this.crossingProtected) this.crossingBaseline = this.pedestrians.getCrossingProgress().crossed;
        this.crossingProtected = true;
        // Os carros que já ocupam a faixa saem antes de os demais pararem na retenção.
        this.traffic.applyMobilityAction(roadId, 'release');
        this.traffic.setCrossingGuarded(true);
        return true;
      }
      if (action === 'release' && this.completedSteps.has(201) && !this.pedestrians.getCrossingProgress().occupied) {
        if (!this.completedSteps.has(202)) {
          void 0;
          this.patch(crossing.id, { status: 'MAINTENANCE', instruction: 'Travessia protegida. Ajuste o controlador da faixa.' });
          this.openRepair('crossing');
        }
      }
    }
    if (action === 'release') {
      this.traffic.setCrossingGuarded(false);
      this.crossingProtected = false;
    }
    this.traffic.applyMobilityAction(roadId === 'orla-escape' ? 'orla-eastbound' : roadId, action);
    return true;
  }

  guidance(player: Player): { target: Point | null; prompt: string | null } {
    const problem = this.objective(player);
    const held = this.items.heldBy(2) === 'cone';
    const crate = this.map.cellCenter(this.map.itemSources[0].column, this.map.itemSources[0].row);
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
      && item.status !== 'RESOLVED' && item.requiredTeams?.includes('infraestrutura')
      && distance(player.position, this.serviceTarget(item)) <= 1.6) : null;
    const prompt = near ? near.id === 'broken-light-pole-1' ? 'REPARAR CIRCUITO'
      : near.id === 'sensor-failure' ? 'INSTALAR SENSOR'
        : near.id === 'traffic-signal-failure' ? 'SINCRONIZAR SEMÁFORO'
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
  }

  dispose(): void {
    this.ringGeometry.dispose(); this.boxGeometry.dispose(); this.antennaGeometry.dispose();
    this.warningMaterial.dispose(); this.sensorMaterial.dispose();
    this.markerMaterials.forEach(material => material.dispose());
    this.group.clear();
  }
}
