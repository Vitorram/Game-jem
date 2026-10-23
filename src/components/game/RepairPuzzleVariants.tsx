'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

type CommonProps = { paused: boolean; onComplete: () => void; onCancel?: () => void };

function PuzzleFrame({ title, chip, description, paused, solved, status, progress, children, onCancel, cardClassName = '' }: {
  title: string; chip: string; description: string; paused: boolean; solved: boolean;
  status: string; progress: string; children: ReactNode; onCancel?: () => void; cardClassName?: string;
}) {
  return <div className="repair-puzzle-overlay" style={paused ? { display: 'none' } : undefined} role="dialog" aria-modal="true">
    <section className={`repair-puzzle-card field-puzzle-card ${cardClassName}${solved ? ' is-solved' : ''}`}>
      <header className="repair-puzzle-header"><span className="repair-puzzle-kicker">OFICINA DE CAMPO · CENTRAL DE OPERAÇÕES</span><span className="repair-puzzle-chip">{chip}</span>
        {onCancel && <button type="button" className="repair-puzzle-cancel" onClick={onCancel}>Voltar aos testes</button>}
        <h2>{title}</h2><p>{description}</p>
      </header>
      {children}
      <div className="repair-puzzle-status" role="status" aria-live="polite"><i className={solved ? 'is-on' : ''} />{status}</div>
      <footer className="repair-puzzle-footer"><span>{progress}</span></footer>
    </section>
  </div>;
}

export function CrossingPlanPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const [plan, setPlan] = useState({ green: 18, yellow: 2, allRed: 1, walk: 6, clearance: 2 });
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('Ajuste o ciclo para dar tempo à travessia e incluir o intervalo de segurança.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const checks = [
    ['Verde dos veículos', plan.green >= 16 && plan.green <= 24, '16–24 s'],
    ['Amarelo de transição', plan.yellow >= 3 && plan.yellow <= 5, '3–5 s'],
    ['Todos vermelhos', plan.allRed >= 2, 'mín. 2 s'],
    ['Travessia de pedestres', plan.walk >= 8 && plan.walk <= 16, '8–16 s'],
    ['Tempo para esvaziar faixa', plan.clearance >= 4, 'mín. 4 s'],
    ['Ciclo total', Object.values(plan).reduce((sum, value) => sum + value, 0) <= 48, 'máx. 48 s'],
  ] as const;
  const fields: Array<{ key: keyof typeof plan; label: string; min: number; max: number }> = [
    { key: 'green', label: 'Verde dos carros', min: 14, max: 30 }, { key: 'yellow', label: 'Amarelo', min: 0, max: 7 },
    { key: 'allRed', label: 'Intervalo vermelho', min: 0, max: 6 }, { key: 'walk', label: 'Sinal de pedestres', min: 4, max: 20 },
    { key: 'clearance', label: 'Faixa livre antes do verde', min: 0, max: 9 },
  ];
  const validate = () => {
    if (paused || solved) return;
    const failed = checks.find(([, valid]) => !valid);
    if (failed) { setStatus(`Plano inseguro: revise “${failed[0]}” antes de validar.`); return; }
    setSolved(true); setStatus('Ciclo seguro aprovado. Os pedestres atravessam antes da retomada dos carros.');
    timer.current = setTimeout(onComplete, 900);
  };
  return <PuzzleFrame title="PROGRAME A TRAVESSIA" chip="FAIXA 03" description="Monte um ciclo completo. O fluxo só volta quando a faixa estiver vazia." paused={paused} solved={solved} status={status} progress={`${Object.values(plan).reduce((sum, value) => sum + value, 0)} s DE CICLO`} onCancel={onCancel}>
    <div className="crossing-plan-layout">
      <div className="crossing-phase-preview"><div className="crossing-light"><i /><i /><i /></div><div className="crossing-zebra"><span /><span /><span /><span /><span /></div><strong>SEQUÊNCIA DO CICLO</strong><div className="crossing-phase-strip"><b>CARROS</b><b>AMARELO</b><b>TODOS<br />VERMELHOS</b><b>PEDESTRES</b><b>LIMPAR<br />FAIXA</b></div></div>
      <div className="crossing-controls">{fields.map(field => <label className="puzzle-range-row" key={field.key}><span>{field.label}<b>{plan[field.key]} s</b></span><input type="range" min={field.min} max={field.max} value={plan[field.key]} disabled={paused || solved} onChange={event => setPlan(current => ({ ...current, [field.key]: Number(event.target.value) }))} /></label>)}</div>
      <div className="puzzle-check-grid">{checks.map(([label, valid, target]) => <div key={label} className={valid ? 'is-valid' : 'is-invalid'}><i>{valid ? '✓' : '!'}</i><span>{label}<small>{target}</small></span></div>)}</div>
      <button className="puzzle-primary-action" type="button" onClick={validate} disabled={paused || solved}>VALIDAR CICLO SEGURO</button>
    </div>
  </PuzzleFrame>;
}

export function SensorCalibrationPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const [config, setConfig] = useState({ threshold: 28, window: 2, sensitivity: 5 });
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('Compare ruído, precisão e atraso. Ajuste o sensor antes de salvar.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const falseAlarms = Math.max(0, Math.ceil((36 - config.threshold) / 3)) + Math.max(0, 4 - config.window) + Math.max(0, config.sensitivity - 3);
  const missed = Math.max(0, Math.ceil((config.threshold - 38) / 3)) + Math.max(0, 2 - config.sensitivity) * 2;
  const delay = config.window * 0.2;
  const valid = config.threshold >= 34 && config.threshold <= 38 && config.window >= 4 && config.window <= 6 && config.sensitivity >= 2 && config.sensitivity <= 3;
  const save = () => {
    if (paused || solved) return;
    if (!valid) { setStatus('A leitura falha: mire em limiar 34–38, janela 4–6 e sensibilidade 2–3.'); return; }
    setSolved(true); setStatus('Leituras estáveis: sem alarmes falsos e com tempo de resposta seguro.'); timer.current = setTimeout(onComplete, 900);
  };
  const sliders: Array<{ key: keyof typeof config; label: string; min: number; max: number }> = [
    { key: 'threshold', label: 'Limiar de detecção', min: 20, max: 55 }, { key: 'window', label: 'Janela de amostragem', min: 1, max: 8 },
    { key: 'sensitivity', label: 'Sensibilidade', min: 1, max: 5 },
  ];
  return <PuzzleFrame title="CALIBRE O SENSOR DE FLUXO" chip="SENSOR 05" description="Diferencie veículos reais do ruído da via sem aumentar o atraso da leitura." paused={paused} solved={solved} status={status} progress={`${valid ? 'CALIBRAÇÃO DENTRO DA FAIXA' : 'CALIBRAÇÃO PENDENTE'} · ${delay.toFixed(1)} s DE RESPOSTA`} onCancel={onCancel}>
    <div className="sensor-calibration-board"><div className="sensor-live-panel"><div className={`sensor-radar${valid ? ' is-stable' : ''}`}><i /><i /><i /><b>RADAR<br />ORLA</b></div><div className="sensor-readings"><div className={falseAlarms <= 1 ? 'is-valid' : 'is-invalid'}><small>FALSOS ALERTAS</small><strong>{falseAlarms}</strong></div><div className={missed <= 1 ? 'is-valid' : 'is-invalid'}><small>VEÍCULOS PERDIDOS</small><strong>{missed}</strong></div><div className={delay <= 1.2 ? 'is-valid' : 'is-invalid'}><small>ATRASO</small><strong>{delay.toFixed(1)} s</strong></div></div></div>
      <div className="sensor-sliders">{sliders.map(slider => <label className="puzzle-range-row" key={slider.key}><span>{slider.label}<b>{config[slider.key]}{slider.key === 'threshold' ? '%' : ''}</b></span><input type="range" min={slider.min} max={slider.max} value={config[slider.key]} disabled={paused || solved} onChange={event => setConfig(current => ({ ...current, [slider.key]: Number(event.target.value) }))} /></label>)}</div>
      <div className="sensor-target-note">ALVO: limiar 34–38% · janela 4–6 · sensibilidade 2–3</div><button className="puzzle-primary-action" type="button" onClick={save} disabled={paused || solved}>SALVAR CALIBRAÇÃO</button>
    </div>
  </PuzzleFrame>;
}

export function ChargerRepairPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const sequence = [
    { id: 'isolate', label: 'Isolar o disjuntor', detail: 'Corte a alimentação antes de tocar no conector.' },
    { id: 'connect', label: 'Reconectar o cabo', detail: 'Encaixe o conector de carga e confira a trava.' },
    { id: 'reset', label: 'Rearmar o carregador', detail: 'Restaure a energia depois de testar a conexão.' },
  ] as const;
  const [step, setStep] = useState(0);
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('Siga a ordem de segurança para devolver o ponto de carga à avenida verde.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const choose = (id: string) => {
    if (paused || solved) return;
    if (sequence[step]?.id !== id) {
      setStatus('Ordem insegura. Isole a energia antes de mexer nos cabos.');
      return;
    }
    const nextStep = step + 1;
    setStep(nextStep);
    if (nextStep === sequence.length) {
      setSolved(true);
      setStatus('Carregador testado e liberado. Os elétricos podem voltar à avenida verde.');
      timer.current = setTimeout(onComplete, 850);
    } else {
      setStatus(sequence[nextStep].detail);
    }
  };

  return <PuzzleFrame title="REPARAR CARREGADOR ELÉTRICO" chip="PONTO 02" description="Desvie o fluxo e siga a sequência segura para recuperar o carregador." paused={paused} solved={solved} status={status} progress={`${step}/3 ETAPAS DE SEGURANÇA`} onCancel={onCancel} cardClassName="charger-repair-puzzle">
    <div className="charger-repair-board">
      <div className="charger-repair-visual" aria-hidden="true"><i>ϟ</i><b>{solved ? 'CARGA ATIVA' : 'PONTO ISOLADO'}</b><span className={solved ? 'is-live' : ''} /></div>
      <div className="charger-repair-actions">
        {sequence.map((action, index) => <button key={action.id} type="button" className={index < step ? 'is-done' : undefined} disabled={paused || solved || index < step} onClick={() => choose(action.id)}>
          <i>{index < step ? '✓' : index + 1}</i><span><b>{action.label}</b><small>{action.detail}</small></span>
        </button>)}
      </div>
    </div>
  </PuzzleFrame>;
}

type TrafficVehicle = {
  id: string;
  label: string;
  code: string;
  row: number;
  col: number;
  length: 2 | 3;
  axis: 'horizontal' | 'vertical';
  color: string;
};

const INITIAL_TRAFFIC: TrafficVehicle[] = [
  { id: 'shuttle', label: 'Micro-ônibus', code: 'BUS', row: 0, col: 0, length: 2, axis: 'horizontal', color: 'yellow' },
  { id: 'compact', label: 'Compacto', code: 'CITY', row: 5, col: 0, length: 2, axis: 'horizontal', color: 'lime' },
  { id: 'bus', label: 'Van de apoio', code: 'APOIO', row: 1, col: 3, length: 2, axis: 'vertical', color: 'teal' },
  { id: 'van', label: 'Van escolar', code: 'VAN', row: 4, col: 5, length: 2, axis: 'vertical', color: 'cream' },
  { id: 'rescue', label: 'Carro de resgate', code: 'RESGATE', row: 2, col: 1, length: 2, axis: 'horizontal', color: 'rescue' },
  { id: 'taxi', label: 'Táxi', code: 'TAXI', row: 3, col: 4, length: 2, axis: 'horizontal', color: 'orange' },
  { id: 'family', label: 'Carro familiar', code: 'FAM', row: 4, col: 0, length: 2, axis: 'horizontal', color: 'violet' },
];

function slideTrafficVehicle(vehicles: TrafficVehicle[], id: string, distance: number): TrafficVehicle[] | null {
  const vehicle = vehicles.find(item => item.id === id);
  if (!vehicle || distance === 0) return null;
  const deltaRow = vehicle.axis === 'vertical' ? Math.sign(distance) : 0;
  const deltaCol = vehicle.axis === 'horizontal' ? Math.sign(distance) : 0;
  const steps = Math.abs(distance);
  const maxRow = 6 - (vehicle.axis === 'vertical' ? vehicle.length : 1);
  const maxCol = id === 'rescue' ? 5 : 6 - (vehicle.axis === 'horizontal' ? vehicle.length : 1);
  const occupied = new Set<string>();
  for (const other of vehicles) {
    if (other.id === id) continue;
    for (let part = 0; part < other.length; part += 1) {
      const row = other.row + (other.axis === 'vertical' ? part : 0);
      const col = other.col + (other.axis === 'horizontal' ? part : 0);
      occupied.add(`${row}:${col}`);
    }
  }
  let nextRow = vehicle.row;
  let nextCol = vehicle.col;
  for (let step = 0; step < steps; step += 1) {
    nextRow += deltaRow;
    nextCol += deltaCol;
    if (nextRow < 0 || nextRow > maxRow || nextCol < 0 || nextCol > maxCol) return null;
    for (let part = 0; part < vehicle.length; part += 1) {
      const row = nextRow + (vehicle.axis === 'vertical' ? part : 0);
      const col = nextCol + (vehicle.axis === 'horizontal' ? part : 0);
      if (row >= 0 && row < 6 && col >= 0 && col < 6 && occupied.has(`${row}:${col}`)) return null;
    }
  }
  return vehicles.map(item => item.id === id ? { ...item, row: nextRow, col: nextCol } : item);
}

export function CollisionSafetyPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const [vehicles, setVehicles] = useState(INITIAL_TRAFFIC);
  const [selected, setSelected] = useState('bus');
  const [moves, setMoves] = useState(0);
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('Etapa 1 de 2: mova a van de apoio uma casa para cima. Depois, leve o resgate até a saída.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const selectedVehicle = vehicles.find(vehicle => vehicle.id === selected) ?? vehicles[0];
  const target = vehicles.find(vehicle => vehicle.id === 'rescue')!;
  const routeOpen = !vehicles.some(vehicle => vehicle.id !== 'rescue'
    && vehicle.row <= 2 && vehicle.row + (vehicle.axis === 'vertical' ? vehicle.length : 1) > 2
    && vehicle.col + (vehicle.axis === 'horizontal' ? vehicle.length : 1) > target.col + target.length - 1);
  const activeId = routeOpen ? 'rescue' : 'bus';
  const stars = moves === 0 ? 0 : moves <= 5 ? 3 : moves <= 7 ? 2 : 1;
  const slide = (id: string, distance: number) => {
    if (paused || solved) return;
    if (id !== activeId || id === 'bus' && distance >= 0 || id === 'rescue' && distance <= 0) return;
    const next = slideTrafficVehicle(vehicles, id, distance);
    if (!next) return;
    const nextMoves = moves + Math.abs(distance);
    setVehicles(next); setMoves(nextMoves);
    const rescued = next.find(vehicle => vehicle.id === 'rescue')!.col >= 5;
    const opened = !next.some(vehicle => vehicle.id !== 'rescue'
      && vehicle.row <= 2 && vehicle.row + (vehicle.axis === 'vertical' ? vehicle.length : 1) > 2
      && vehicle.col + (vehicle.axis === 'horizontal' ? vehicle.length : 1) > 2);
    if (rescued) {
      setSolved(true); setStatus('Resgate concluído! A faixa foi liberada e os veículos já podem seguir.');
      timer.current = setTimeout(onComplete, 1100);
    } else if (opened) {
      setSelected('rescue'); setStatus('Etapa 2 de 2: faixa liberada! Arraste o carro vermelho até a saída.');
    } else if (id === 'rescue') setStatus('Continue levando o carro vermelho até a saída.');
    else setStatus('Boa! A faixa foi aberta. Agora selecione o carro vermelho e leve-o até a saída.');
  };
  const onCarKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, vehicle: TrafficVehicle) => {
    const direction = event.key === 'ArrowLeft' && vehicle.axis === 'horizontal' ? -1
      : event.key === 'ArrowRight' && vehicle.axis === 'horizontal' ? 1
        : event.key === 'ArrowUp' && vehicle.axis === 'vertical' ? -1
          : event.key === 'ArrowDown' && vehicle.axis === 'vertical' ? 1 : 0;
    if (!direction) return;
    event.preventDefault(); slide(vehicle.id, direction);
  };
  const onCarPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, vehicle: TrafficVehicle) => {
    if (paused || solved) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(vehicle.id);
    event.currentTarget.dataset.dragStart = `${event.clientX}:${event.clientY}`;
  };
  const onCarPointerUp = (event: ReactPointerEvent<HTMLButtonElement>, vehicle: TrafficVehicle) => {
    const start = event.currentTarget.dataset.dragStart?.split(':').map(Number);
    delete event.currentTarget.dataset.dragStart;
    if (!start || start.length !== 2) return;
    const board = event.currentTarget.parentElement;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const distance = vehicle.axis === 'horizontal'
      ? Math.round((event.clientX - start[0]) / (rect.width / 6))
      : Math.round((event.clientY - start[1]) / (rect.height / 6));
    if (distance) slide(vehicle.id, distance);
  };
  const nudge = (direction: -1 | 1) => selectedVehicle && slide(selectedVehicle.id, direction);
  const reset = () => {
    if (paused || solved) return;
    setVehicles(INITIAL_TRAFFIC); setSelected('bus'); setMoves(0);
    setStatus('Etapa 1 de 2: mova a van de apoio uma casa para cima. Depois, leve o resgate até a saída.');
  };
  return <PuzzleFrame title="LIBERE A ROTA DE RESGATE" chip="MISSÃO 06 · TRÂNSITO" description="Siga duas etapas rápidas para abrir a faixa e levar o resgate até a saída." paused={paused} solved={solved} status={status} progress={`${moves} ${moves === 1 ? 'CASA' : 'CASAS'} · ${stars}/3 ESTRELAS`} onCancel={onCancel} cardClassName="collision-safety-puzzle traffic-jam-puzzle">
    <div className="traffic-jam-layout">
      <div className="traffic-jam-board-wrap">
        <div className={`traffic-jam-board${routeOpen ? ' route-open' : ''}${solved ? ' is-cleared' : ''}`} role="group" aria-label="Tabuleiro de trânsito com seis veículos. Mova a van de apoio e depois leve o carro de resgate até a saída.">
          {vehicles.map(vehicle => <button key={vehicle.id} type="button"
            className={`traffic-jam-car axis-${vehicle.axis} car-${vehicle.color}${selected === vehicle.id ? ' is-selected' : ''}${vehicle.id === 'rescue' ? ' is-rescue' : ''}`}
            style={{ top: `${vehicle.row * 100 / 6}%`, left: `${vehicle.col * 100 / 6}%`, width: `${vehicle.length * 100 / 6}%`, height: `${100 / 6}%` } as CSSProperties}
            aria-label={`${vehicle.label}, faixa ${vehicle.axis === 'horizontal' ? 'horizontal' : 'vertical'}${selected === vehicle.id ? ', selecionado' : ''}`}
            aria-pressed={selected === vehicle.id} disabled={paused || solved || vehicle.id !== activeId}
            onClick={() => setSelected(vehicle.id)} onKeyDown={event => onCarKeyDown(event, vehicle)}
            onPointerDown={event => onCarPointerDown(event, vehicle)} onPointerUp={event => onCarPointerUp(event, vehicle)}
            onPointerCancel={event => { delete event.currentTarget.dataset.dragStart; }}>
            <span className="traffic-car-shell"><i className="traffic-car-window" /><b>{vehicle.code}</b><i className="traffic-car-wheel wheel-a" /><i className="traffic-car-wheel wheel-b" /></span>
          </button>)}
          <div className="traffic-jam-lane-label">CORREDOR DE RESGATE</div>
        </div>
        <div className={`traffic-jam-exit${routeOpen ? ' is-open' : ''}${solved ? ' is-cleared' : ''}`} aria-label={solved ? 'Saída liberada' : routeOpen ? 'Saída aberta' : 'Saída bloqueada'}><span>SAÍDA</span><b>{solved ? '✓' : '➜'}</b></div>
      </div>
      <aside className="traffic-jam-console">
        <div className="traffic-jam-mission"><span>{solved ? 'MISSÃO CONCLUÍDA' : `ETAPA ${routeOpen ? '2' : '1'} DE 2`}</span><b>{solved ? 'ROTA LIBERADA!' : routeOpen ? 'LEVE O RESGATE' : 'ABRA A FAIXA'}</b><small>{solved ? 'Resgate concluído' : routeOpen ? 'Arraste o carro vermelho à direita' : 'Mova a van verde uma casa para cima'}</small></div>
        <div className="traffic-jam-stage-track"><span className={routeOpen ? 'is-done' : 'is-current'}><b>{routeOpen ? '✓' : '1'}</b> ABRIR FAIXA</span><span className={solved ? 'is-done' : routeOpen ? 'is-current' : ''}><b>{solved ? '✓' : '2'}</b> RESGATAR</span></div>
        <div className="traffic-jam-score"><div><small>CASAS MOVIDAS</small><b>{moves.toString().padStart(2, '0')}</b></div><div><small>EFICIÊNCIA</small><b className="traffic-jam-stars">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</b></div></div>
        <div className="traffic-jam-selected"><span>VEÍCULO SELECIONADO</span><b>{selectedVehicle?.label ?? 'Escolha um carro'}</b><small>{selectedVehicle?.axis === 'horizontal' ? 'Move para os lados' : 'Move para cima ou para baixo'}</small></div>
        <div className="traffic-jam-controls" aria-label="Mover veículo selecionado">
          <button type="button" aria-label="Mover para cima" disabled={paused || solved || selected !== activeId || activeId !== 'bus' || !slideTrafficVehicle(vehicles, activeId, -1)} onClick={() => nudge(-1)}>↑</button>
          <button type="button" aria-label="Mover para a esquerda" disabled>←</button>
          <button type="button" aria-label="Mover para baixo" disabled>↓</button>
          <button type="button" aria-label="Mover para a direita" disabled={paused || solved || selected !== activeId || activeId !== 'rescue' || !slideTrafficVehicle(vehicles, activeId, 1)} onClick={() => nudge(1)}>→</button>
        </div>
        <p className="traffic-jam-hint">Toque e arraste os carros. No computador, também pode selecionar e usar as setas do teclado.</p>
        <button type="button" className="traffic-jam-reset" onClick={reset} disabled={paused || solved}>REINICIAR DESAFIO</button>
      </aside>
    </div>
  </PuzzleFrame>;
}

export function CyclistRepairPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const [step, setStep] = useState(0);
  const [tension, setTension] = useState(5);
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('A corrente saiu da coroa. Alivie a tensão antes de encaixar e conferir a transmissão.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const steps = ['Aliviar o câmbio', 'Assentar a corrente', 'Regular a tensão', 'Lubrificar os elos', 'Testar a transmissão'];
  const advance = (index: number) => {
    if (paused || solved || step !== index) return;
    if (index === 2 && (tension < 8 || tension > 10)) { setStatus('A corrente precisa ceder entre 8 e 10 mm. Ajuste o tensor e meça de novo.'); return; }
    const next = step + 1; setStep(next);
    if (next === steps.length) { setSolved(true); setStatus('Transmissão girando sem saltos. O ciclista está seguro para seguir.'); timer.current = setTimeout(onComplete, 950); }
    else setStatus(index === 1 ? 'Corrente encaixada. Agora ajuste a folga correta no tensor.' : `${steps[next]}: prossiga com cuidado para não forçar a corrente.`);
  };
  const labels = ['ALIVIAR CÂMBIO', 'ASSENTAR CORRENTE', 'MEDIR E FIXAR', 'LUBRIFICAR ELOS', 'GIRAR E TESTAR'];
  return <PuzzleFrame title="AJUDE A TRANSMISSÃO" chip="CICLISTA 07" description="A corrente escapou. Faça o procedimento mecânico e confira a tensão antes do teste." paused={paused} solved={solved} status={status} progress={`${Math.min(step, steps.length)}/5 ETAPAS`} onCancel={onCancel}>
    <div className="cyclist-repair-board"><div className={`bike-chain-illustration${step >= 2 ? ' is-seated' : ''}`}><div className="bike-wheel wheel-back" /><div className="bike-wheel wheel-front" /><div className="bike-frame" /><div className="bike-chain"><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="chain-gear gear-large" /><div className="chain-gear gear-small" /><span className="chain-tool">🔧</span></div>
      <ol className="cyclist-procedure">{steps.map((label, index) => <li key={label} className={index < step ? 'is-done' : index === step ? 'is-current' : ''}><b>{index < step ? '✓' : index + 1}</b>{label}</li>)}</ol>
      {step === 2 && <label className="puzzle-range-row cyclist-tension"><span>Folga medida<b>{tension} mm</b></span><input type="range" min="3" max="14" value={tension} disabled={paused || solved} onChange={event => setTension(Number(event.target.value))} /><small>Faixa de serviço: 8–10 mm</small></label>}
      <button className="puzzle-primary-action" type="button" onClick={() => advance(step)} disabled={paused || solved}>{labels[step] ?? 'TRANSMISSÃO APROVADA'}</button>
    </div>
  </PuzzleFrame>;
}

export function SignalCheckPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const [timing, setTiming] = useState({ yellow: 1, clearance: 0, cycle: 16 });
  const ropeTrack = useRef<HTMLDivElement>(null);
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('Compare o controlador com o plano da via e sincronize as três janelas de tempo.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const checks = [
    ['Amarelo após o verde', Math.abs(timing.yellow - 4) <= 1, '4 s ± 1'],
    ['Intervalo antes do próximo sentido', Math.abs(timing.clearance - 3) <= 1, '3 s ± 1'],
    ['Ciclo completo', Math.abs(timing.cycle - 12) <= 1, '12 s ± 1'],
  ] as const;
  const adjustFromRope = (key: keyof typeof timing, min: number, max: number, clientX: number, zoneStart: number, zoneEnd: number) => {
    const bounds = ropeTrack.current?.getBoundingClientRect();
    if (!bounds) return;
    const trackPosition = (clientX - bounds.left) / bounds.width;
    const ratio = Math.max(0, Math.min(1, (trackPosition - zoneStart) / (zoneEnd - zoneStart)));
    setTiming(current => ({ ...current, [key]: Math.round(min + ratio * (max - min)) }));
  };
  const handleRopeKey = (event: ReactKeyboardEvent<HTMLSpanElement>, key: keyof typeof timing, min: number, max: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const change = event.key === 'ArrowRight' ? 1 : -1;
    setTiming(current => ({ ...current, [key]: Math.max(min, Math.min(max, current[key] + change)) }));
  };
  const ropePointerHandlers = (key: keyof typeof timing, min: number, max: number, zoneStart: number, zoneEnd: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (paused || solved) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      adjustFromRope(key, min, max, event.clientX, zoneStart, zoneEnd);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (event.buttons === 1 && !paused && !solved) adjustFromRope(key, min, max, event.clientX, zoneStart, zoneEnd);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLSpanElement>) => handleRopeKey(event, key, min, max),
  });
  const validate = () => {
    if (paused || solved) return;
    const failed = checks.find(([, valid]) => !valid);
    if (failed) { setStatus(`Fora de sincronismo: revise “${failed[0]}” e faça outra leitura.`); return; }
    setSolved(true); setStatus('Controlador sincronizado com a via. Três ciclos de teste passaram.'); timer.current = setTimeout(onComplete, 900);
  };
  return <PuzzleFrame title="SINCRONIZE O CONTROLADOR" chip="SEMÁFORO 08" description="Calibre os tempos do amarelo, do intervalo de segurança e do ciclo completo." paused={paused} solved={solved} status={status} progress={`${checks.filter(([, valid]) => valid).length}/3 LEITURAS NA TOLERÂNCIA`} onCancel={onCancel} cardClassName="signal-timing-puzzle">
    <div className="signal-check-board"><div className="signal-check-visual"><div className="signal-check-lamp"><i className="lamp-red" /><i className="lamp-yellow" /><i className="lamp-green" /></div><div className="signal-rope-panel"><div className="signal-rope-heading"><b>LINHA DE SINCRONIA</b><span>ARRASTE OS NÓS PARA AJUSTAR</span></div><div className="signal-rope" ref={ropeTrack} aria-label={`Amarelo ${timing.yellow} segundos, intervalo ${timing.clearance} segundos, ciclo ${timing.cycle} segundos`}><i className="signal-rope-cord" /><span className="signal-rope-knot knot-yellow" style={{ left: `${6 + timing.yellow / 8 * 22}%` }} role="slider" tabIndex={0} aria-label="Tempo do amarelo" aria-valuemin={0} aria-valuemax={8} aria-valuenow={timing.yellow} {...ropePointerHandlers('yellow', 0, 8, 0.06, 0.28)}><b>{timing.yellow}s</b><i /><small>AMARELO</small></span><span className="signal-rope-knot knot-clearance" style={{ left: `${38 + timing.clearance / 7 * 24}%` }} role="slider" tabIndex={0} aria-label="Intervalo de segurança" aria-valuemin={0} aria-valuemax={7} aria-valuenow={timing.clearance} {...ropePointerHandlers('clearance', 0, 7, 0.38, 0.62)}><b>{timing.clearance}s</b><i /><small>SEGURANÇA</small></span><span className="signal-rope-knot knot-cycle" style={{ left: `${72 + (timing.cycle - 8) / 12 * 22}%` }} role="slider" tabIndex={0} aria-label="Ciclo completo" aria-valuemin={8} aria-valuemax={20} aria-valuenow={timing.cycle} {...ropePointerHandlers('cycle', 8, 20, 0.72, 0.94)}><b>{timing.cycle}s</b><i /><small>CICLO</small></span></div></div></div>
      <div className="signal-check-controls">{([
        { key: 'yellow', label: 'Amarelo', min: 0, max: 8, suffix: 's' }, { key: 'clearance', label: 'Intervalo de segurança', min: 0, max: 7, suffix: 's' },
        { key: 'cycle', label: 'Ciclo completo', min: 8, max: 20, suffix: 's' },
      ] as const).map(control => <label className="puzzle-range-row" key={control.key}><span>{control.label}<b>{timing[control.key]}{control.suffix}</b></span><input type="range" min={control.min} max={control.max} value={timing[control.key]} disabled={paused || solved} onChange={event => setTiming(current => ({ ...current, [control.key]: Number(event.target.value) }))} /></label>)}</div>
      <div className="puzzle-check-grid">{checks.map(([label, valid, target]) => <div key={label} className={valid ? 'is-valid' : 'is-invalid'}><i>{valid ? '✓' : '!'}</i><span>{label}<small>{target}</small></span></div>)}</div><button className="puzzle-primary-action" type="button" onClick={validate} disabled={paused || solved}>RODAR TESTE DE SINCRONISMO</button>
    </div>
  </PuzzleFrame>;
}

const DEBRIS = [
  { id: 'leaves', icon: '🍂', label: 'Folhas', bin: 'organic' }, { id: 'can', icon: '🥫', label: 'Lata amassada', bin: 'recycle' },
  { id: 'glass', icon: '◇', label: 'Caco de vidro', bin: 'hazard' }, { id: 'branch', icon: '🪵', label: 'Galho', bin: 'organic' },
  { id: 'bottle', icon: '▱', label: 'Garrafa plástica', bin: 'recycle' }, { id: 'nail', icon: '⚠', label: 'Prego solto', bin: 'hazard' },
] as const;
const CLEANUP_BINS = [
  { id: 'organic', label: 'ORGÂNICO', icon: '♻' }, { id: 'recycle', label: 'RECICLÁVEL', icon: '▤' }, { id: 'hazard', label: 'CORTANTE / RISCO', icon: '⚠' },
] as const;

export function BikeCleanupPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sorted, setSorted] = useState<Record<string, string>>({});
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('Separe os resíduos. Vidros e metais pontiagudos precisam de descarte protegido.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const place = (bin: string, itemId = selected) => {
    if (!itemId || paused || solved) return;
    const debris = DEBRIS.find(item => item.id === itemId)!;
    if (debris.bin !== bin) { setStatus(`${debris.label}: descarte incorreto. Confira o material e escolha outro recipiente.`); return; }
    const next = { ...sorted, [itemId]: bin }; setSorted(next); setSelected(null);
    if (Object.keys(next).length === DEBRIS.length) { setSolved(true); setStatus('Resíduos separados com segurança. A ciclovia está limpa e liberada.'); timer.current = setTimeout(onComplete, 900); }
    else setStatus(`${debris.label} separado. Continue até retirar todos os obstáculos.`);
  };
  return <PuzzleFrame title="LIBERE A CICLOVIA COM SEGURANÇA" chip="CICLOVIA 09" description="Identifique cada obstáculo e coloque-o no recipiente correto antes de reabrir a passagem." paused={paused} solved={solved} status={status} progress={`${Object.keys(sorted).length}/${DEBRIS.length} OBJETOS REMOVIDOS`} onCancel={onCancel}>
    <div className="bike-cleanup-board"><div className="debris-lane"><div className="lane-stripe" /><span className="lane-label">CICLOVIA BLOQUEADA</span>{DEBRIS.filter(item => !sorted[item.id]).map(item => <button key={item.id} type="button" draggable disabled={paused || solved} className={`debris-object${selected === item.id ? ' is-selected' : ''}`} onClick={() => { setSelected(item.id); setStatus(`${item.label} selecionado. Escolha o recipiente adequado.`); }} onDragStart={event => { setSelected(item.id); event.dataTransfer.setData('text/plain', item.id); }} aria-pressed={selected === item.id}><b>{item.icon}</b><small>{item.label}</small></button>)}</div>
      <div className="cleanup-bins">{CLEANUP_BINS.map(bin => <button key={bin.id} type="button" className={`cleanup-bin bin-${bin.id}${selected ? ' can-receive' : ''}`} disabled={paused || solved} onClick={() => place(bin.id)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (id) place(bin.id, id); }}><b>{bin.icon}</b><span>{bin.label}</span><small>{DEBRIS.filter(item => sorted[item.id] === bin.id).length} objetos</small></button>)}</div>
      <p className="cleanup-hint">Toque em um objeto e depois no recipiente; também pode arrastar.</p>
    </div>
  </PuzzleFrame>;
}
