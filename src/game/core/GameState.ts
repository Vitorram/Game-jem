import type { PlayerId } from '../entities/Player';

export type ProblemStatus = 'ACTIVE' | 'MAINTENANCE' | 'RESOLVED';
export type ResponseTeam = 'infraestrutura' | 'mobilidade';
export type UrbanProblem = {
  id: 'broken-light-pole-1';
  type: 'broken-light-pole';
  label: 'POSTE';
  status: ProblemStatus;
  position: { x: number; z: number };
  dispatchedTeams: ResponseTeam[];
};

export type RoadState = {
  id: string;
  direction: 'NORMAL' | 'REVERSE';
  status: 'open' | 'blocked' | 'stopped';
  type: 'PRINCIPAL' | 'SECUNDARIA' | 'ESCAPE';
  capacity: number;
  priority: number;
  redirected: boolean;
  vehicleCount: number;
  congestion: number;
  conesActive: boolean;
  coneZoneId: string | null;
};

export type GameStateSnapshot = {
  activeCharacter: PlayerId;
  selectedProblemId: UrbanProblem['id'] | null;
  budget: number;
  problems: UrbanProblem[];
  roads: RoadState[];
};

/** Estado central compartilhado pelas entidades da partida. */
export class GameState {
  private state: GameStateSnapshot = {
    activeCharacter: 1,
    selectedProblemId: null,
    budget: 1000,
    problems: [{
      id: 'broken-light-pole-1', type: 'broken-light-pole', label: 'POSTE',
      status: 'ACTIVE', position: { x: -9, z: 5.7 }, dispatchedTeams: [],
    }],
    roads: [
      { id: 'orla-eastbound', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-eastbound-2', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-westbound', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-westbound-2', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-escape', direction: 'NORMAL', status: 'blocked', type: 'ESCAPE', capacity: 30, priority: 0, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
    ],
  };

  snapshot(): GameStateSnapshot { return structuredClone(this.state); }

  get activeCharacter(): PlayerId { return this.state.activeCharacter; }

  setActiveCharacter(id: PlayerId): void { this.state.activeCharacter = id; }

  selectProblem(id: UrbanProblem['id'] | null): void {
    if (id !== null && !this.state.problems.some(problem => problem.id === id && problem.status !== 'RESOLVED')) return;
    this.state.selectedProblemId = id;
  }

  setBudget(budget: number): void {
    if (!Number.isFinite(budget) || budget < 0) throw new Error('Orçamento inválido.');
    this.state.budget = budget;
  }

  setProblems(problems: UrbanProblem[]): void {
    this.state.problems = structuredClone(problems);
  }

  setProblemStatus(id: UrbanProblem['id'], status: ProblemStatus): void {
    const problem = this.state.problems.find(item => item.id === id);
    if (problem) problem.status = status;
  }

  dispatchTeam(id: UrbanProblem['id'], team: ResponseTeam): void {
    const problem = this.state.problems.find(item => item.id === id);
    if (!problem || problem.status === 'RESOLVED' || this.state.selectedProblemId !== id || problem.dispatchedTeams.includes(team)) return;
    problem.dispatchedTeams.push(team);
  }

  setRoads(roads: RoadState[]): void {
    this.state.roads = structuredClone(roads);
  }
}

/** Uma única instância para o jogo; todas as personagens leem e escrevem aqui. */
export const suburbanGameState = new GameState();
