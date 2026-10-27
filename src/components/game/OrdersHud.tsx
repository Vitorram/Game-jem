'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { gsap } from 'gsap';
import type { SessionEvent, SessionSnapshot } from '@/game/session/GameSession';
import { sessionStore, starsFor } from '@/game/session/sessionStore';
import styles from './OrdersHud.module.css';
import { ORLA_EVENTS, ORLA_EVENT_STEPS } from '@/game/session/orlaEvents';
import { suburbanGameState, type UrbanProblem } from '@/game/core/GameState';
import FarewellIllustration from './FarewellIllustration';
import FeedbackToast from './FeedbackToast';

type HudOrder = SessionSnapshot['orders'][number];

/** Marcos confirmados pela cena, e não por cliques no HUD. */
const RISK_STEPS: Record<number, { icon: string; label: string }> = {
  ...ORLA_EVENT_STEPS,
  1: { icon: '📡', label: 'Acionar as duas equipes' },
  2: { icon: '🚧', label: 'Preparar uma área segura' },
  3: { icon: '💡', label: 'Reparar o poste' },
};

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const formatTime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

function currentOrderPoints(order: HudOrder): number {
  const bonus = Math.max(0, Math.floor(order.maxSpeedBonus * (order.remainingMs / order.timeLimitMs)));
  return Math.max(0, order.basePoints + bonus);
}

function Ticket({ order, problem }: { order: HudOrder; problem?: UrbanProblem }) {
  const root = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!root.current || reducedMotion()) return;
    const tween = gsap.from(root.current, { y: -36, opacity: 0, duration: 0.45, ease: 'back.out(1.7)' });
    return () => { tween.kill(); };
  }, []);

  const next = RISK_STEPS[order.riskIds[order.completedSteps]];
  const potentialPoints = currentOrderPoints(order);
  const progressPct = Math.round((order.completedSteps / Math.max(1, order.riskIds.length)) * 100);
  return (
    <li ref={root} className={styles.ticket}>
      <span className={styles.title}>{order.title}</span>
      <span className={styles.hint}>
        {problem?.requiredTeams?.map(team => team === 'mobilidade' ? 'Mobilidade' : 'Infraestrutura').join(' + ')}
        {` · +${potentialPoints} pts`}
      </span>
      <span className={styles.steps}>
        {order.riskIds.map((id, index) => {
          const step = RISK_STEPS[id] ?? { icon: '❓', label: `Risco ${id}` };
          const state = index < order.completedSteps ? 'done' : index === order.completedSteps ? 'next' : 'todo';
          return (
            <span key={id} className={styles.step} data-state={state} title={step.label}>
              {state === 'done' ? '✓' : step.icon}
            </span>
          );
        })}
      </span>
      <span className={styles.hint}>{problem?.stage === 'warning' ? problem.instruction : next ? `Agora: ${next.label}` : ''}</span>
      <button className={styles.focus} onClick={event => { suburbanGameState.selectProblem(order.definitionId); event.currentTarget.blur(); }}>Marcar objetivo →</button>
      <span className={styles.bar} aria-hidden="true">
        <i
          className={styles.fill}
          style={{
            width: `${progressPct}%`,
            background: '#46c46a',
            transition: 'width 0.3s ease',
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
    <div ref={root} className={styles.coin} role="status" aria-label={`Pontuação: ${score} pontos`}>
      <span className={styles.coinFace} aria-hidden="true">PTS</span>
      <b>{score}</b>
    </div>
  );
}

function describe(event: SessionEvent): { text: string; tone: 'good' | 'bad' | 'info' } | null {
  switch (event.type) {
    case 'order-completed':
      return { tone: 'good', text: `Ocorrência resolvida! +${event.points} pontos${event.speedBonus > 0 ? ` (bônus de agilidade +${event.speedBonus})` : ''}` };
    case 'score-warning':
      return { tone: 'info', text: event.message };
    case 'order-arrived':
      return { tone: 'info', text: ORLA_EVENTS.find(item => item.id === event.order.definitionId)?.warning ?? event.order.title };
    default:
      return null;
  }
}

const SUMMARY_MESSAGES = [
  'A orla ainda precisa de você. Continue praticando!',
  'Um bom começo: a orla já está mais segura.',
  'Muito bem! O trecho está bem cuidado.',
  'Orla segura para todas!',
];

const END_CREDITS = [
  { role: 'Visual e história', name: 'Caroline Marrre' },
  { role: 'Desenvolvimento dos personagens e lógica', name: 'Vitor Ramos' },
  { role: 'Mapa e elementos do trânsito', name: 'Tiago Vieira' },
  { role: 'Música, efeitos e cenas', name: 'Pedro Lawal' },
];

function EndCredits() {
  return <section className={styles.credits} aria-label="Créditos da fase">
    <h3>CRÉDITOS</h3>
    <div className={styles.creditsWindow}>
      <div className={styles.creditsRoll}>
        {END_CREDITS.map(credit => <div className={styles.credit} key={credit.role}>
          <span>{credit.role}</span><b>{credit.name}</b>
        </div>)}
      </div>
    </div>
  </section>;
}

function Summary({ snapshot, onMenu, onRestart }: { snapshot: SessionSnapshot; onMenu?: () => void; onRestart?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const stars = starsFor(snapshot.score);
  const allMissionsCompleted = snapshot.completedOrders === ORLA_EVENTS.length;

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
      <div className={`${styles.card}${allMissionsCompleted ? ` ${styles.farewellCard}` : ''}`}>
        <h2>{allMissionsCompleted ? 'Obrigado por jogar!' : 'Orla recuperada!'}</h2>
        {allMissionsCompleted
          ? <FarewellIllustration className={styles.farewellIllustration} />
          : <div className={styles.stars} aria-label={`${stars} de 3 estrelas`}>
            {[1, 2, 3].map(n => <span key={n} className={styles.star} data-on={n <= stars}>★</span>)}
          </div>}
        <p className={`${styles.verdict}${allMissionsCompleted ? ` ${styles.farewellVerdict}` : ''}`}>{allMissionsCompleted
          ? 'Obrigado por jogar nossa primeira fase! Ficaremos felizes em ter você para testar nossas próximas fases e nosso modo coop. Nos veremos em breve!'
          : SUMMARY_MESSAGES[stars]}</p>
        {allMissionsCompleted && <EndCredits />}
        <dl className={styles.stats}>
          <div><dt>Pontos</dt><dd>{snapshot.score}</dd></div>
          <div><dt>Ocorrências</dt><dd>{snapshot.completedOrders}/{ORLA_EVENTS.length}</dd></div>
          <div><dt>Tempo total</dt><dd>{formatTime(snapshot.elapsedMs)}</dd></div>
        </dl>
        <button type="button" className={styles.primary} onClick={() => onRestart ? onRestart() : sessionStore.restart()}>Jogar de novo</button>
        {onMenu && <button type="button" className={styles.primary} onClick={onMenu}>Voltar ao menu</button>}
      </div>
    </div>
  );
}

export default function OrdersHud({ showDebug = false, onMenu, onRestart }: {
  paused?: boolean; showDebug?: boolean; onMenu?: () => void; onContinue?: () => void; onRestart?: () => void;
}) {
  const { snapshot, feedback } = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getServerSnapshot);
  const [world, setWorld] = useState(() => suburbanGameState.snapshot());
  useEffect(() => {
    const timer = window.setInterval(() => setWorld(suburbanGameState.snapshot()), 300);
    return () => window.clearInterval(timer);
  }, []);
  if (!snapshot) return null;

  return (
    <>
      <div className={styles.strip} aria-label="Pedidos da fase">
        <Coin score={snapshot.score} />
        <ol className={styles.tickets}>
          {snapshot.orders.map(order => (
            <Ticket key={order.id} order={order} problem={world.problems.find(problem => problem.id === order.definitionId)} />
          ))}
        </ol>
        <div className={styles.clock} role="status" aria-label={`Ocorrências concluídas: ${snapshot.completedOrders} de ${ORLA_EVENTS.length}`}>
          <span aria-hidden="true">✓</span> {snapshot.completedOrders}/{ORLA_EVENTS.length}
        </div>
      </div>
      <FeedbackToast sequence={feedback?.seq} message={feedback ? describe(feedback.event) : null} />
      {showDebug && snapshot.status === 'playing' && snapshot.orders[0] && (
        <button type="button" className={styles.debug} onClick={() => sessionStore.debugResolveNext()}>
          Resolver passo do pedido (teste)
        </button>
      )}
      {snapshot.status === 'finished' && <Summary snapshot={snapshot} onMenu={onMenu} onRestart={onRestart} />}
    </>
  );
}
