'use client';

import { useEffect, useRef } from 'react';
import type { PlayerId } from '@/game/entities/Player';
import type { CoopRoom } from '@/game/network/CoopClient';
import styles from './CoopTeamBriefing.module.css';

const lessons: { role: PlayerId; title: string; controls: string; duty: string }[] = [
  { role: 1, title: 'Infraestrutura', controls: 'WASD para mover · E para iniciar reparos', duty: 'Cuida dos postes, sensores, veículos e puzzles de manutenção.' },
  { role: 2, title: 'Mobilidade', controls: 'WASD para mover · 1–4 para ações de trânsito · E para interagir', duty: 'Protege travessias, administra as faixas e libera obstáculos.' },
  { role: 3, title: 'Analista', controls: 'Clique no chamado para analisar, acionar equipes e arquivar', duty: 'Coordena a equipe pelo tablet e acompanha os chamados.' },
];

export default function CoopTeamBriefing({ role, room, onDismiss }: { role: PlayerId; room: CoopRoom | null; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), 12_000);
    return () => clearTimeout(timer);
  }, []);

  return <aside className={styles.briefing} aria-label="Resumo cooperativo">
    <header><div><span>TUTORIAL DA EQUIPE · COMEÇAMOS JUNTOS</span><h2>Três papéis, uma cidade.</h2></div>
      <button onClick={onDismiss} aria-label="Fechar tutorial">×</button></header>
    <div className={styles.cards}>{lessons.map(lesson => <article key={lesson.role} data-active={role === lesson.role || undefined}>
      <b>{lesson.title}{role === lesson.role ? ' · VOCÊ' : ''}</b>
      <em>{room?.players.find(player => player.role === lesson.role)?.name ?? 'Papel sem jogador'}</em>
      <p>{lesson.duty}</p><small>{lesson.controls}</small>
    </article>)}</div>
    <footer>Seu personagem é reservado nesta partida. A equipe toda compartilha chamados e ações.</footer>
  </aside>;
}
