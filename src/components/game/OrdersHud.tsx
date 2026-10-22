'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { gsap } from 'gsap';
import type { SessionEvent, SessionSnapshot } from '@/game/session/GameSession';
import { sessionStore, starsFor, type SessionView } from '@/game/session/sessionStore';
import styles from './OrdersHud.module.css';

type HudOrder = SessionSnapshot['orders'][number];

/** Marcos confirmados pela cena, e não por cliques no HUD. */
const RISK_STEPS: Record<number, { icon: string; label: string }> = {
  1: { icon: '📡', label: 'Acionar as duas equipes' },
  2: { icon: '🚧', label: 'Preparar uma área segura' },
  3: { icon: '💡', label: 'Reparar o poste' },
};

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const formatTime = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function Ticket({ order, queued, frozen }: { order: HudOrder; queued: boolean; frozen: boolean }) {
  const root = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!root.current || reducedMotion()) return;
    const tween = gsap.from(root.current, { y: -36, opacity: 0, duration: 0.45, ease: 'back.out(1.7)' });
    return () => { tween.kill(); };
  }, []);

  const next = RISK_STEPS[order.riskIds[order.completedSteps]];
  return (
    <li ref={root} className={styles.ticket} data-queued={queued || undefined}>
      <span className={styles.title}>{order.title}</span>
      <span className={styles.steps}>
        {order.riskIds.map((id, index) => {
          const step = RISK_STEPS[id] ?? { icon: '❓', label: `Risco ${id}` };
          const state = index < order.completedSteps ? 'done' : index === order.completedSteps && !queued ? 'next' : 'todo';
          return (
            <span key={id} className={styles.step} data-state={state} title={step.label}>
              {state === 'done' ? '✓' : step.icon}
            </span>
          );
        })}
      </span>
      <span className={styles.hint}>{queued ? 'Na fila' : next ? `Agora: ${next.label}` : ''}</span>
      <span className={styles.bar} aria-hidden="true">
        <i
          className={styles.fill}
          style={{
            width: `${order.remainingMs / order.timeLimitMs * 100}%`,
            background: order.remainingMs < 30_000 ? '#e5484d' : '#46c46a',
            transition: frozen ? 'none' : 'width 1s linear',
          }}
        />
      </span>
    </li>
  );
}

function Coin({ score }: { score: number }) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(score);
  useEffect(() => {
    const tween = previous.current !== score && root.current && !reducedMotion()
      ? gsap.fromTo(root.current, { scale: 1.3 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' }) : undefined;
    previous.current = score;
    return () => { tween?.kill(); };
  }, [score]);
  return (
    <div ref={root} className={styles.coin} role="status" aria-label={`Pontuação: ${score}`}>
      <span className={styles.coinFace} aria-hidden="true">$</span>
      <b>{score}</b>
    </div>
  );
}

function describe(event: SessionEvent): { text: string; tone: 'good' | 'bad' | 'info' } | null {
  switch (event.type) {
    case 'order-completed':
      return { tone: 'good', text: `Missão cumprida! +${event.points}${event.speedBonus > 0 ? ` (bônus de rapidez +${event.speedBonus})` : ''}` };
    case 'order-expired':
      return { tone: 'bad', text: `Prazo encerrado −${event.penalty}` };
    case 'order-arrived':
      return { tone: 'info', text: 'Acione as equipes com a Analista' };
    default:
      return null;
  }
}

function Toast({ feedback }: { feedback: SessionView['feedback'] }) {
  const root = useRef<HTMLDivElement>(null);
  const seq = feedback?.seq;
  useEffect(() => {
    const node = root.current;
    if (!node || seq === undefined) return;
    if (reducedMotion()) {
      gsap.set(node, { opacity: 1, y: 0, scale: 1 });
      const fade = gsap.to(node, { opacity: 0, delay: 1.6, duration: 0.2 });
      return () => { fade.kill(); };
    }
    const timeline = gsap.timeline();
    timeline
      .fromTo(node, { y: 14, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.28, ease: 'back.out(2)' })
      .to(node, { opacity: 0, y: -8, duration: 0.35, delay: 1.3 });
    return () => { timeline.kill(); };
  }, [seq]);
  const message = feedback ? describe(feedback.event) : null;
  return (
    <div ref={root} className={styles.toast} data-tone={message?.tone} role="status" aria-live="polite">
      {message?.text}
    </div>
  );
}

const SUMMARY_MESSAGES = [
  'A orla ainda precisa de você. Tente de novo.',
  'Um bom começo: a orla já está mais segura.',
  'Muito bem! O trecho está bem cuidado.',
  'Orla segura para todas!',
];

function Summary({ snapshot, onMenu }: { snapshot: SessionSnapshot; onMenu?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const stars = starsFor(snapshot.score);

  useEffect(() => {
    const node = root.current;
    if (!node || reducedMotion()) return;
    const context = gsap.context(() => {
      gsap.from(node.querySelector(`.${styles.card}`), { scale: 0.85, opacity: 0, duration: 0.4, ease: 'back.out(1.6)' });
      gsap.from(node.querySelectorAll('[data-on="true"]'), { scale: 0, rotate: -40, duration: 0.45, delay: 0.35, stagger: 0.25, ease: 'back.out(3)' });
    }, node);
    return () => context.revert();
  }, []);

  return (
    <div ref={root} className={styles.summary} role="dialog" aria-modal="true" aria-label="Fim de fase">
      <div className={styles.card}>
        <h2>{snapshot.completedOrders ? 'Orla recuperada!' : 'Tempo esgotado!'}</h2>
        <div className={styles.stars} aria-label={`${stars} de 3 estrelas`}>
          {[1, 2, 3].map(n => <span key={n} className={styles.star} data-on={n <= stars}>★</span>)}
        </div>
        <p className={styles.verdict}>{SUMMARY_MESSAGES[stars]}</p>
        <dl className={styles.stats}>
          <div><dt>Pontos</dt><dd>{snapshot.score}</dd></div>
          <div><dt>Missões</dt><dd>{snapshot.completedOrders}</dd></div>
          <div><dt>Não concluídas</dt><dd>{snapshot.expiredOrders}</dd></div>
        </dl>
        <button type="button" className={styles.primary} onClick={() => sessionStore.restart()}>Jogar de novo</button>
        {onMenu && <button type="button" className={styles.primary} onClick={onMenu}>Voltar ao menu</button>}
      </div>
    </div>
  );
}

/**
 * HUD de pedidos. `paused` congela as barras (a cena também para de avançar o relógio).
 * Renderize FORA do bloco `status === 'playing'` para a barra continuar sincronizada ao retomar.
 */
export default function OrdersHud({ paused, showDebug = false, onMenu }: { paused: boolean; showDebug?: boolean; onMenu?: () => void }) {
  const { snapshot, feedback } = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getServerSnapshot);
  if (!snapshot) return null;

  const frozen = paused || snapshot.status !== 'playing';
  const urgent = snapshot.status === 'playing' && snapshot.remainingMs <= 30_000;
  return (
    <>
      <div className={styles.strip} aria-label="Pedidos da fase">
        <Coin score={snapshot.score} />
        <ol className={styles.tickets}>
          {snapshot.orders.map((order, index) => (
            <Ticket key={order.id} order={order} queued={index > 0} frozen={frozen} />
          ))}
        </ol>
        <div className={styles.clock} data-urgent={urgent || undefined} role="timer" aria-label="Tempo restante da fase">
          <span aria-hidden="true">⏱</span> {formatTime(snapshot.remainingMs)}
        </div>
      </div>
      <Toast feedback={feedback} />
      {showDebug && snapshot.status === 'playing' && snapshot.orders[0] && (
        <button type="button" className={styles.debug} onClick={() => sessionStore.debugResolveNext()}>
          Resolver passo do pedido (teste)
        </button>
      )}
      {snapshot.status === 'finished' && <Summary snapshot={snapshot} onMenu={onMenu} />}
    </>
  );
}

