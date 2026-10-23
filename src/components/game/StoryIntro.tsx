'use client';

import { useEffect, useRef, useState } from 'react';
import type { IntroPlayback, IntroShot } from '@/game/cinematics/IntroWorld';
import styles from './StoryIntro.module.css';

const SCRIPT = ([
  { text: 'Toda cidade tem um ritmo.\nE alguém precisa cuidar dele.', shot: 'city', minimum: 4800 },
  { text: 'Três amigas criaram o Suburban, um sistema para tornar o trânsito mais seguro e a cidade mais humana.', shot: 'city', minimum: 6200 },
  { text: 'Pelas câmeras e pelos chamados da população, o Suburban acompanha o movimento da cidade.', shot: 'city', minimum: 7000 },
  { text: 'Um acidente. Uma fila começa a crescer. O sistema identifica o problema e aciona quem pode ajudar.', shot: 'incident', minimum: 7000 },
  { text: 'A Analista acompanha. A Mobilidade protege o trecho. A Infraestrutura chega para resolver. Juntas, elas fazem a cidade seguir.', shot: 'response', minimum: 7500 },
  { text: 'Ajude nossas amigas a testar o Suburban e provar o que essa ideia pode fazer pela cidade. Boa sorte!', shot: 'team', minimum: 6500 },
] satisfies { text: string; shot: IntroShot; minimum: number }[]).map(beat => {
  let at = 450;
  const letters = Array.from(beat.text);
  const timing = letters.map(letter => { at += /[.!?]/.test(letter) ? 180 : letter === '\n' ? 260 : 29; return at; });
  return { ...beat, letters, timing, typingEnd: at, duration: Math.max(beat.minimum, at + 2000) };
});

function soundtrack() {
  const context = new AudioContext();
  const master = context.createGain(); master.gain.value = .16; master.connect(context.destination);
  [130.81, 196, 261.63].forEach((frequency, i) => {
    const voice = context.createOscillator(), level = context.createGain();
    voice.type = 'sine'; voice.frequency.value = frequency; voice.detune.value = i * 3;
    level.gain.value = .035; voice.connect(level); level.connect(master); voice.start();
  });
  return {
    context,
    cue: (success: boolean) => {
      const voice = context.createOscillator(), envelope = context.createGain();
      voice.type = 'sine'; voice.frequency.setValueAtTime(success ? 523.25 : 392, context.currentTime);
      voice.frequency.exponentialRampToValueAtTime(success ? 783.99 : 523.25, context.currentTime + .18);
      envelope.gain.setValueAtTime(.001, context.currentTime); envelope.gain.exponentialRampToValueAtTime(.3, context.currentTime + .025);
      envelope.gain.exponentialRampToValueAtTime(.001, context.currentTime + .5);
      voice.connect(envelope); envelope.connect(master); voice.start(); voice.stop(context.currentTime + .55);
      voice.onended = () => { voice.disconnect(); envelope.disconnect(); };
    },
    dispose: () => { void context.close(); },
  };
}

function CinematicWorld({ shot, reducedMotion, paused }: IntroPlayback) {
  const host = useRef<HTMLDivElement>(null);
  const playback = useRef({ shot, reducedMotion, paused });
  playback.current = { shot, reducedMotion, paused };
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
}

export default function StoryIntro({ onComplete }: { onComplete: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const audio = useRef<ReturnType<typeof soundtrack> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishing = useRef(false);
  const [sound, setSound] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [clock, setClock] = useState({ beat: 0, time: 0 });
  const [exiting, setExiting] = useState(false);
  const beat = SCRIPT[clock.beat];
  const finale = clock.beat === SCRIPT.length - 1;
  const cinema = clock.beat >= 2;
  const count = reducedMotion ? beat.letters.length : beat.timing.filter(at => at <= clock.time).length;
  const typed = count === beat.letters.length;

  useEffect(() => {
    root.current?.focus();
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(query.matches);
    motion(); query.addEventListener('change', motion);
    return () => { query.removeEventListener('change', motion); audio.current?.dispose(); if (exitTimer.current) clearTimeout(exitTimer.current); };
  }, []);

  useEffect(() => {
    const visibility = () => {
      if (!audio.current) return;
      if (document.hidden || paused || !sound) void audio.current.context.suspend();
      else void audio.current.context.resume();
    };
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [paused, sound]);

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

  useEffect(() => { if (sound && !paused && clock.beat > 0) audio.current?.cue(clock.beat >= 4); }, [clock.beat, sound, paused]);

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
  const toggleSound = async () => {
    try {
      if (!audio.current) audio.current = soundtrack();
      if (!sound) await audio.current.context.resume(); else await audio.current.context.suspend();
      setSound(!sound);
    } catch { setSound(false); }
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
    <div className={styles.film}><CinematicWorld shot={beat.shot} reducedMotion={reducedMotion} paused={paused || exiting || !cinema} /></div>
    <div className={styles.vignette} aria-hidden="true" />
    <header className={styles.topbar}>
      <span className={styles.signature}><b>S</b> SUBURBAN <i /> <small>PRÓLOGO</small></span>
      <nav aria-label="Controles do prólogo"><button onClick={toggleSound} aria-pressed={sound}>{sound ? '♪ Som ligado' : '♪ Ativar som'}</button><button onClick={() => setPaused(value => !value)} aria-label={paused ? 'Continuar prólogo' : 'Pausar prólogo'}>{paused ? '▶' : 'Ⅱ'}</button><button onClick={finish}>Pular <span>↗</span></button></nav>
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
