import type { PlayerId } from '../entities/Player';

export type MapPoint = { x: number; z: number };
export type InfraTool = 'sensor' | 'light';
export type Issue = MapPoint & { id: number; title: string; detail: string; revealed: boolean; marked: boolean };
export type AbilitySnapshot = {
  role: PlayerId; tool: InfraTool; sensors: MapPoint[];
  light: (MapPoint & { level: number }) | null;
  stops: MapPoint[]; draft: MapPoint[]; editing: boolean; selectedStop: number;
  issues: Issue[]; selectedIssue: number | null; message: string;
};
const defaultStops = (): MapPoint[] => [{ x: -4, z: 3 }, { x: 0, z: 0 }, { x: 4, z: -3 }];
const initial = (role: PlayerId): AbilitySnapshot => ({
  role, tool: 'sensor', sensors: [], light: null, stops: defaultStops(), draft: defaultStops(),
  editing: false, selectedStop: 0, selectedIssue: null,
  issues: [
    { id: 1, x: -3, z: -2, title: 'Iluminação insuficiente', detail: 'Trecho de teste com pouca luz. Encaminhe para Infraestrutura.', revealed: false, marked: false },
    { id: 2, x: 2, z: 2, title: 'Parada distante', detail: 'Caminhada longa até o transporte. Encaminhe para Mobilidade.', revealed: false, marked: false },
    { id: 3, x: 4, z: -4, title: 'Trecho sem monitoramento', detail: 'Um sensor ajudaria a acompanhar este trajeto.', revealed: false, marked: false },
  ],
  message: 'Escolha uma ferramenta e pressione E para testar.',
});
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const bounded = (point: MapPoint): MapPoint => ({ x: Math.max(-8, Math.min(8, point.x)), z: Math.max(-8, Math.min(8, point.z)) });

/** Estado de demonstração, compartilhado entre as três telas e mantido só na sessão. */
export class AbilityLab {
  private state = initial(1);
  private readonly onChange: (state: AbilitySnapshot) => void;
  constructor(onChange: (state: AbilitySnapshot) => void = () => {}) { this.onChange = onChange; }
  snapshot(): AbilitySnapshot { return structuredClone(this.state); }
  get movementBlocked() { return this.state.role === 3 || this.state.editing; }
  private emit(message: string) { this.state.message = message; this.onChange(this.snapshot()); }
  selectRole(role: PlayerId) {
    this.state.role = role;
    this.state.editing = false;
    this.state.draft = this.state.stops.map(point => ({ ...point }));
    this.emit(role === 1 ? 'WASD para andar. E usa a ferramenta escolhida.' : role === 2 ? 'Enter abre a edição de pontos e rotas.' : 'Clique nos sinais ? do mapa para investigar. Depois marque os riscos.');
  }
  setTool(tool: InfraTool) {
    if (this.state.role !== 1) return;
    this.state.tool = tool;
    this.emit(tool === 'sensor' ? 'E instala um sensor à frente da personagem (máximo de 5).' : 'E cria uma luz de teste e alterna: suave, forte e desligada.');
  }
  activate(point: MapPoint) {
    if (this.state.role === 1) {
      if (this.state.tool === 'sensor') {
        if (this.state.sensors.length >= 5) return this.emit('Os 5 sensores de teste já foram instalados. Reinicie para testar de novo.');
        const position = bounded(point);
        if (this.state.sensors.some(sensor => distance(sensor, position) < 0.8)) return this.emit('Já existe um sensor aqui. Ande um pouco antes de instalar outro.');
        this.state.sensors.push(position);
        this.emit(`Sensor ${this.state.sensors.length}/5 instalado. O círculo verde mostra seu alcance de teste.`);
      } else {
        if (!this.state.light) this.state.light = { ...bounded(point), level: 0 };
        this.state.light.level = (this.state.light.level + 1) % 3;
        this.emit(['Luz de teste desligada.', 'Iluminação suave ativada.', 'Iluminação forte ativada.'][this.state.light.level]);
      }
    } else if (this.state.role === 2) {
      if (this.state.editing) {
        this.state.stops = this.state.draft.map(stop => ({ ...stop }));
        this.state.editing = false;
        this.emit('Rota aplicada! A linha roxa na plataforma mostra o novo trajeto.');
      } else {
        this.state.editing = true;
        this.state.draft = this.state.stops.map(stop => ({ ...stop }));
        this.emit('Escolha A, B ou C e clique no mapa para mover. Enter confirma a rota.');
      }
    }
  }
  selectStop(index: number) {
    if (this.state.role !== 2 || !this.state.editing || index < 0 || index > 2) return;
    this.state.selectedStop = index;
    this.emit(`Ponto ${'ABC'[index]} selecionado. Clique em outra posição no mapa.`);
  }
  mapClick(point: MapPoint, mark = false) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
    if (this.state.role === 2 && this.state.editing) {
      const position = bounded(point);
      if (this.state.draft.some((stop, index) => index !== this.state.selectedStop && distance(stop, position) < 1)) return this.emit('Deixe um espaço entre os pontos de ônibus.');
      this.state.draft[this.state.selectedStop] = position;
      this.emit(`Ponto ${'ABC'[this.state.selectedStop]} reposicionado. Enter aplica a alteração.`);
    } else if (this.state.role === 3) {
      const issue = this.state.issues.find(item => distance(item, point) < 1.1);
      if (!issue) return this.emit('Clique em um dos três sinais ? do mapa. São problemas simulados para este teste.');
      this.inspect(issue.id, mark);
    }
  }
  inspect(id: number, mark = false) {
    if (this.state.role !== 3) return;
    const issue = this.state.issues.find(item => item.id === id);
    if (!issue) return;
    this.state.selectedIssue = id;
    if (mark && !issue.revealed) return this.emit('Inspecione este ponto antes de marcá-lo.');
    if (mark) {
      issue.marked = !issue.marked;
      this.emit(issue.marked ? 'Risco marcado para a equipe. Ele aparece nas três telas.' : 'Marcação removida.');
    } else {
      issue.revealed = true;
      this.emit(issue.detail);
    }
  }
  reset() { const role = this.state.role; this.state = initial(role); this.emit('Teste reiniciado: sensores, iluminação, rota e marcações foram restaurados.'); }
}
