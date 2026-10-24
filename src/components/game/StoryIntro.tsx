'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { IntroPlayback, IntroShot } from '@/game/cinematics/IntroWorld';
import styles from './StoryIntro.module.css';

const SCRIPT = ([
  { text: 'Toda cidade tem um ritmo.\nÀs vezes, basta um instante para mudá-lo.', shot: 'city', minimum: 4800 },
  { text: 'Três amigas criaram o Suburban\npara tornar a cidade mais segura.', shot: 'city', minimum: 5600 },
  { text: 'Câmeras e chamados ajudam o sistema\na perceber quando algo sai do normal.', shot: 'city', minimum: 5600 },
  { text: 'Um acidente interrompe a via.\nA fila cresce. O Suburban dá o alerta.', shot: 'incident', minimum: 5600 },
  { text: 'A Analista aciona a equipe.\nA Mobilidade protege o local.\nA Infraestrutura resolve o problema.', shot: 'response', minimum: 6400 },
  { text: 'Agora é com você.\nAjude a equipe a manter a cidade em movimento.', shot: 'team', minimum: 5600 },
] satisfies { text: string; shot: IntroShot; minimum: number }[]).map(beat => {
  let at = 450;
  const letters = Array.from(beat.text);
  const timing = letters.map(letter => {
    at += /[.!?]/.test(letter) ? 300 : /[,;:]/.test(letter) ? 150 : letter === '\n' ? 420 : letter === ' ' ? 13 : 25;
    return at;
  });
  return { ...beat, letters, timing, typingEnd: at, duration: Math.max(beat.minimum, at + 2000) };
});

const CinematicWorld = memo(function CinematicWorld({ shot, beat, reducedMotion, paused }: IntroPlayback) {
  const host = useRef<HTMLDivElement>(null);
  const playback = useRef({ shot, beat, reducedMotion, paused });
  playback.current = { shot, beat, reducedMotion, paused };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    import('@/game/cinematics/IntroWorld').then(({ createIntroWorld }) => {
      if (cancelled || !host.current) return;
      dispose = createIntroWorld(host.current, () => playback.current);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; dispose?.(); };
  }, []);
  return <div ref={host} className={styles.world} data-shot={shot} aria-hidden="true">
    {failed && <div className={styles.fallback}><span /><i /><b /></div>}
  </div>;
});

export default function StoryIntro({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishing = useRef(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [clock, setClock] = useState({ beat: 0, time: 0 });
  const [exiting, setExiting] = useState(false);
  const beat = SCRIPT[clock.beat];
  const finale = clock.beat === SCRIPT.length - 1;
  const cinema = clock.beat >= 2;
  // A digitação do texto é parte da leitura do prólogo, não um movimento de câmera.
  // Mantemos o efeito mesmo quando o sistema pede movimento reduzido.
  const count = beat.timing.filter(at => at <= clock.time).length;
  const typed = count === beat.letters.length;

  useEffect(() => {
    root.current?.focus();
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(query.matches);
    motion(); query.addEventListener('change', motion);
    return () => { query.removeEventListener('change', motion); if (exitTimer.current) clearTimeout(exitTimer.current); };
  }, []);

  useEffect(() => {
    if (paused || exiting) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(), delta = Math.min(now - previous, 120); previous = now;
      if (document.hidden) return;
      setClock(current => {
        const end = SCRIPT[current.beat].duration, time = current.time + delta;
        if (time >= end && current.beat < SCRIPT.length - 1) return { beat: current.beat + 1, time: 0 };
        return { ...current, time: Math.min(time, end) };
      });
    }, 40);
    return () => clearInterval(timer);
  }, [paused, exiting]);

  const finish = () => {
    if (finishing.current) return;
    finishing.current = true; setExiting(true);
    exitTimer.current = setTimeout(onComplete, reducedMotion ? 0 : 650);
  };
  const advance = () => {
    if (exiting) return;
    if (!typed) { setClock(current => ({ ...current, time: beat.typingEnd + 100 })); return; }
    if (finale) { finish(); return; }
    setClock(current => ({ beat: current.beat + 1, time: 0 }));
  };
  return <div ref={root} tabIndex={-1} className={`${styles.intro} ${cinema ? styles.cinema : ''} ${finale ? styles.finale : ''} ${exiting ? styles.exiting : ''}`} role="dialog" aria-modal="true" aria-label="Prólogo do Suburban" onKeyDown={event => {
    event.stopPropagation();
    if ((event.key === ' ' || event.key === 'Enter') && event.target === root.current) { event.preventDefault(); advance(); }
    if (event.key === 'Tab') {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first.focus(); }
    }
  }}>
    <div className={styles.film}><CinematicWorld shot={beat.shot} beat={clock.beat} reducedMotion={reducedMotion} paused={paused || exiting || !cinema} /></div>
    <div className={styles.vignette} aria-hidden="true" />
    <header className={styles.topbar}>
      <span className={styles.signature}><b>S</b> SUBURBAN <i /> <small>PRÓLOGO</small></span>
      <nav aria-label="Controles do prólogo"><button onClick={() => setPaused(value => !value)} aria-label={paused ? 'Continuar prólogo' : 'Pausar prólogo'}>{paused ? '▶' : 'Ⅱ'}</button><button onClick={finish}>Pular <span>↗</span></button></nav>
    </header>
    <section key={`narrative-${clock.beat}`} className={styles.narrative}>
      {finale && <div className={styles.titleReveal}><h1>SUBURBAN</h1></div>}
      <p aria-label={beat.text}><span aria-hidden="true">{beat.letters.slice(0, count).join('')}<span className={styles.cursor}>▎</span></span></p>
      {finale && typed && <button className={styles.startButton} onClick={finish}>Assumir o controle <span>↗</span></button>}
    </section>
    {!finale && <button className={styles.continue} onClick={advance}>{typed ? 'Continuar' : 'Revelar texto'} <span>→</span></button>}
    <div className={styles.exitCurtain} />
  </div>;
}
