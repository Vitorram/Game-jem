'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

type Zone = { left: number; width: number };
type Feedback = 'ACERTO' | 'ERRO' | 'POSTE REPARADO' | null;

const zoneWidths = [30, 25, 21];
const speeds = [2.8, 2.35, 1.95];
const makeZones = (): Zone[] => zoneWidths.map(width => ({
  left: 7 + Math.random() * (86 - width),
  width,
}));

export default function RepairPuzzle({ onComplete }: { onComplete: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pinRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const answerRef = useRef<() => void>(() => undefined);
  const locked = useRef(false);
  const [step, setStep] = useState(0);
  const [zones, setZones] = useState<Zone[]>(makeZones);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    const context = gsap.context(() => {
      gsap.fromTo(cardRef.current, { opacity: 0, y: 18, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'power2.out' });
    }, cardRef);
    return () => context.revert();
  }, []);

  useEffect(() => {
    if (feedback) return;
    const tweens = pinRefs.current.map((pin, index) => {
      if (!pin) return undefined;
      gsap.set(pin, { left: '0%' });
      return gsap.to(pin, { left: '100%', duration: speeds[index], repeat: -1, yoyo: true, ease: 'none' });
    });
    return () => tweens.forEach(tween => tween?.kill());
  }, [feedback, step]);

  const resolveAttempt = useCallback(() => {
    if (locked.current || feedback) return;
    const bar = barRefs.current[step];
    const pin = pinRefs.current[step];
    if (!bar || !pin) return;
    const barRect = bar.getBoundingClientRect();
    const pinRect = pin.getBoundingClientRect();
    const position = ((pinRect.left + pinRect.width / 2 - barRect.left) / barRect.width) * 100;
    const zone = zones[step];
    locked.current = true;

    if (position >= zone.left && position <= zone.left + zone.width) {
      if (step === 2) {
        setFeedback('POSTE REPARADO');
        window.setTimeout(onComplete, 900);
      } else {
        setFeedback('ACERTO');
        window.setTimeout(() => {
          setStep(current => current + 1);
          setFeedback(null);
          locked.current = false;
        }, 480);
      }
      return;
    }

    setFeedback('ERRO');
    window.setTimeout(() => {
      setStep(0);
      setZones(makeZones());
      setFeedback(null);
      locked.current = false;
    }, 650);
  }, [feedback, onComplete, step, zones]);

  useEffect(() => { answerRef.current = resolveAttempt; }, [resolveAttempt]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      event.preventDefault();
      answerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="repair-puzzle-overlay" role="dialog" aria-modal="true" aria-labelledby="repair-puzzle-title" onPointerDown={() => answerRef.current()}>
      <div ref={cardRef} className="repair-puzzle-card">
        <span className="repair-puzzle-kicker">MANUTENÇÃO ELÉTRICA</span>
        <h2 id="repair-puzzle-title">REPARO DE INFRAESTRUTURA</h2>
        <p className="repair-puzzle-stage">ETAPA {step + 1}/3</p>
        <div className="repair-progress" aria-label={`Etapa ${step + 1} de 3`}>
          {[0, 1, 2].map(index => <span key={index} className={index < step ? 'is-done' : index === step ? 'is-current' : ''}>{index < step ? '✓' : `0${index + 1}`}</span>)}
        </div>
        <div className="repair-rows">
          {[0, 1, 2].map(index => (
            <div key={index} className={`repair-row${index === step ? ' is-active' : ''}${index < step ? ' is-done' : ''}`}>
              <div className="repair-row-label"><span>ETAPA 0{index + 1}</span><b>{index < step ? '✓' : index === step ? 'ALINHE O PINO' : 'AGUARDANDO'}</b></div>
              <div className="repair-timing-bar" ref={element => { barRefs.current[index] = element; }}>
                <span className="repair-green-zone" style={{ left: `${zones[index].left}%`, width: `${zones[index].width}%` }} />
                <span className="repair-pin" ref={element => { pinRefs.current[index] = element; }} />
              </div>
            </div>
          ))}
        </div>
        <div className={`repair-feedback${feedback ? ' is-visible' : ''}${feedback === 'ERRO' ? ' is-error' : ''}`} aria-live="assertive">{feedback ?? ' '}</div>
        <p className="repair-instruction">PRESSIONE ESPAÇO OU CLIQUE</p>
      </div>
    </div>
  );
}
