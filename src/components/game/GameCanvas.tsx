'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Game, type GameStatus } from '@/game/core/Game';

const directions = [
  { code: 'ArrowUp', label: 'Mover para cima', symbol: '↑' },
  { code: 'ArrowLeft', label: 'Mover para esquerda', symbol: '←' },
  { code: 'ArrowDown', label: 'Mover para baixo', symbol: '↓' },
  { code: 'ArrowRight', label: 'Mover para direita', symbol: '→' },
];

export default function GameCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [status, setStatus] = useState<GameStatus>('ready');
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current) return;
    let instance: Game;
    try {
      instance = new Game(host.current, setStatus);
      game.current = instance;
      setInitialized(true);
      setError(null);
    } catch (cause) {
      console.error('Falha ao inicializar o jogo:', cause);
      setError('Não foi possível iniciar o 3D. Verifique se a aceleração gráfica está habilitada e recarregue a página.');
      return;
    }
    return () => { instance.dispose(); game.current = null; };
  }, []);

  useEffect(() => {
    if (status === 'playing' || !panel.current) return;
    const context = gsap.context(() => {
      gsap.from(panel.current, {
        opacity: 0, y: 12,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.45,
      });
    }, panel);
    return () => context.revert();
  }, [status, error]);

  return (
    <section className="game-shell" aria-label="Protótipo do jogo">
      <div ref={host} className="viewport" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark">P/0</span><span>PROJETO ZERO<small>BASE DE DESENVOLVIMENTO</small></span></div>
        <span className="build-label">BUILD 0.1</span>
      </header>
      {(status !== 'playing' || error) && (
        <div className="overlay">
          <div ref={panel} className="panel">
            <span className="eyebrow">{error ? 'INICIALIZAÇÃO' : status === 'paused' ? 'UM RESPIRO' : 'O COMEÇO DE UM MUNDO'}</span>
            <h1>{error ? 'Ops, algo falhou.' : status === 'paused' ? 'Jogo pausado.' : <>Tudo começa<br />por aqui<span>.</span></>}</h1>
            <p>{error ?? (status === 'paused' ? 'Seu cenário está esperando. Continue quando quiser.' : 'Uma cena simples para testar a base. O próximo passo é dar vida à sua ideia.')}</p>
            {error ? <button onClick={() => window.location.reload()}>Tentar novamente ↗</button> :
              <button disabled={!initialized} onClick={() => status === 'ready' ? game.current?.start() : game.current?.togglePause()}>
                {!initialized ? 'Preparando…' : status === 'paused' ? 'Continuar →' : 'Entrar no cenário →'}
              </button>}
            <div className="stack">NEXT.JS <i /> THREE.JS <i /> GSAP</div>
          </div>
        </div>
      )}
      {status === 'playing' && !error && <>
        <div className="hud"><span><b>Cena de teste</b><small>Explore a plataforma</small></span><button className="secondary" onClick={() => game.current?.togglePause()}>Pausar · Esc</button></div>
        <div className="touch-controls" aria-label="Controles de movimento">
          {directions.map(({ code, label, symbol }) => <button key={code} aria-label={label}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); game.current?.input.setTouch(event.pointerId, code); }}
            onPointerUp={event => game.current?.input.setTouch(event.pointerId)}
            onPointerCancel={event => game.current?.input.setTouch(event.pointerId)}
            onLostPointerCapture={event => game.current?.input.setTouch(event.pointerId)}
          >{symbol}</button>)}
        </div>
      </>}
      <footer className="bottom-bar"><span>WASD / SETAS <small>MOVER</small></span><span>ESC <small>PAUSAR</small></span><span className="prototype-label">PROTÓTIPO · CENA 01</span></footer>
    </section>
  );
}
