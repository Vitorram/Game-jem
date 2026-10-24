'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

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

const VEHICLE_REPAIR_CABLES = [
  { id: 'yellow', label: 'Amarelo', module: 'motor', moduleLabel: 'Motor', row: 0, targetRow: 2, stroke: '#f4c74f' },
  { id: 'blue', label: 'Azul', module: 'battery', moduleLabel: 'Bateria', row: 1, targetRow: 0, stroke: '#5594f5' },
  { id: 'cyan', label: 'Ciano', module: 'ignition', moduleLabel: 'Ignição', row: 2, targetRow: 1, stroke: '#71e6e7' },
] as const;

const VEHICLE_REPAIR_MODULES = [
  { id: 'battery', label: 'Bateria', cable: 'blue', row: 0, color: 'blue' },
  { id: 'ignition', label: 'Ignição', cable: 'cyan', row: 1, color: 'cyan' },
  { id: 'motor', label: 'Motor', cable: 'yellow', row: 2, color: 'yellow' },
] as const;

export function CollisionSafetyPuzzle({ paused, onComplete, onCancel }: CommonProps) {
  const [selectedCable, setSelectedCable] = useState<string | null>(null);
  const [connectedModules, setConnectedModules] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  const [status, setStatus] = useState('Selecione um cabo e conecte-o à peça com a mesma cor.');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const selectCable = (cableId: string, moduleLabel: string, moduleId: string) => {
    if (paused || solved || connectedModules.includes(moduleId)) return;
    setSelectedCable(cableId);
    setStatus(`Cabo selecionado. Conecte-o à ${moduleLabel.toLowerCase()}.`);
  };

  const connectModule = (module: typeof VEHICLE_REPAIR_MODULES[number]) => {
    if (paused || solved || connectedModules.includes(module.id)) return;
    const cable = VEHICLE_REPAIR_CABLES.find(item => item.id === selectedCable);
    if (!cable) {
      setStatus('Escolha primeiro um dos cabos soltos.');
      return;
    }
    if (cable.module !== module.id) {
      setStatus('As cores não combinam. Tente outro conector; seu progresso está salvo.');
      return;
    }

    const next = [...connectedModules, module.id];
    setConnectedModules(next);
    setSelectedCable(null);
    if (next.length === VEHICLE_REPAIR_MODULES.length) {
      setSolved(true);
      setStatus('Sistema elétrico restaurado. O carro está pronto para voltar à via!');
      timer.current = setTimeout(onComplete, 900);
    } else {
      setStatus(`${module.label} conectado! Falta${VEHICLE_REPAIR_MODULES.length - next.length === 1 ? '' : 'm'} ${VEHICLE_REPAIR_MODULES.length - next.length} conexão${VEHICLE_REPAIR_MODULES.length - next.length === 1 ? '' : 'ões'}.`);
    }
  };

  const reset = () => {
    if (paused || solved) return;
    setSelectedCable(null);
    setConnectedModules([]);
    setStatus('Selecione um cabo e conecte-o à peça com a mesma cor.');
  };

  return <PuzzleFrame title="CONSERTAR SISTEMA DO CARRO" chip="REPARO · VEÍCULO" description="Reconecte os três cabos coloridos para restaurar o carro." paused={paused} solved={solved} status={status} progress={`${connectedModules.length}/3 CABOS CONECTADOS`} onCancel={onCancel} cardClassName="collision-safety-puzzle vehicle-repair-puzzle">
    <div className="vehicle-repair-layout">
      <div className="vehicle-repair-diagnostic">
        <div className={`vehicle-repair-car${solved ? ' is-running' : ''}`} aria-hidden="true">
          <span className="vehicle-repair-wheel wheel-front" /><span className="vehicle-repair-wheel wheel-back" />
          <i className="vehicle-repair-window" /><b>{solved ? 'PRONTO' : 'SEM ENERGIA'}</b>
        </div>
        <div className="vehicle-repair-readout">
          <span>DIAGNÓSTICO DO VEÍCULO</span>
          <b>{solved ? 'SISTEMA ELÉTRICO OK' : 'CONEXÕES INTERROMPIDAS'}</b>
          <small>Motor · bateria · ignição</small>
        </div>
        <p>Escolha um cabo à esquerda e clique na peça da mesma cor. Se errar, pode tentar de novo sem perder o progresso.</p>
      </div>

      <div className="vehicle-repair-wiring" role="group" aria-label="Reconecte os cabos coloridos às peças correspondentes do carro">
        <svg className="vehicle-repair-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {VEHICLE_REPAIR_CABLES.map(cable => <path key={cable.id}
            className={connectedModules.includes(cable.module) ? 'is-connected' : selectedCable === cable.id ? 'is-selected' : ''}
            d={`M 34 ${20 + cable.row * 30} C 46 ${20 + cable.row * 30}, 54 ${20 + cable.targetRow * 30}, 66 ${20 + cable.targetRow * 30}`}
            stroke={cable.stroke} />)}
        </svg>
        <div className="vehicle-repair-cables">
          <h3>CABOS SOLTOS</h3>
          {VEHICLE_REPAIR_CABLES.map((cable, index) => <button key={cable.id} type="button"
            className={`vehicle-repair-cable is-${cable.id}${selectedCable === cable.id ? ' is-selected' : ''}${connectedModules.includes(cable.module) ? ' is-connected' : ''}`}
            style={{ top: `${20 + index * 30}%` }}
            aria-label={`Cabo ${cable.label}${connectedModules.includes(cable.module) ? ', conectado' : ''}`}
            aria-pressed={selectedCable === cable.id} disabled={paused || solved || connectedModules.includes(cable.module)}
            onClick={() => selectCable(cable.id, cable.moduleLabel, cable.module)}>
            <i>{connectedModules.includes(cable.module) ? '✓' : index + 1}</i><span><b>{cable.label}</b><small>{connectedModules.includes(cable.module) ? 'CONECTADO' : 'SELECIONAR'}</small></span>
          </button>)}
        </div>
        <div className="vehicle-repair-modules">
          <h3>PEÇAS DO CARRO</h3>
          {VEHICLE_REPAIR_MODULES.map(module => <button key={module.id} type="button"
            className={`vehicle-repair-module is-${module.color}${connectedModules.includes(module.id) ? ' is-connected' : ''}`}
            style={{ top: `${20 + module.row * 30}%` }}
            aria-label={`${module.label}${connectedModules.includes(module.id) ? ', cabo conectado' : ', conectar cabo selecionado'}`}
            disabled={paused || solved || connectedModules.includes(module.id)}
            onClick={() => connectModule(module)}>
            <i>{connectedModules.includes(module.id) ? '✓' : ''}</i><span><b>{module.label}</b><small>{connectedModules.includes(module.id) ? 'ENERGIZADA' : 'CONECTAR'}</small></span>
          </button>)}
        </div>
      </div>
      <button className="vehicle-repair-reset" type="button" onClick={reset} disabled={paused || solved}>REINICIAR CONEXÕES</button>
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
