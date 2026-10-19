'use client';

import dynamic from 'next/dynamic';

const GameCanvas = dynamic(() => import('./GameCanvas'), {
  ssr: false,
  loading: () => <div className="loading" role="status">Preparando o mundo…</div>,
});

export default function GameLoader() { return <GameCanvas />; }
