'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { Game, type GameStatus } from '@/game/core/Game';
import { PLAYER_APPEARANCES, type PlayerId } from '@/game/entities/Player';
import { AbilityLab } from '@/game/core/AbilityLab';
import AbilityPanel from './AbilityPanel';

const playerIds: PlayerId[] = [1, 2, 3];

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
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerId>(1);
  const [closeView, setCloseView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abilities, setAbilities] = useState(() => new AbilityLab().snapshot());

  useEffect(() => {
    if (!host.current) return;
    let instance: Game;
    try {
      instance = new Game(host.current, setStatus, setAbilities);
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
        <div className="brand"><span className="brand-mark">S</span><span>SUBURBAN<small>LABORATÓRIO DE HABILIDADES</small></span></div>
        <span className="build-label">TESTE LIVRE</span>
      </header>
      {(status !== 'playing' || error) && (
        <div className="overlay">
          <div ref={panel} className="panel">
            <span className="eyebrow">{error ? 'INICIALIZAÇÃO' : status === 'paused' ? 'UM RESPIRO' : 'O COMEÇO DE UM MUNDO'}</span>
            <h1>{error ? 'Ops, algo falhou.' : status === 'paused' ? 'Jogo pausado.' : <>Tudo começa<br />por aqui<span>.</span></>}</h1>
            <p>{error ?? (status === 'paused' ? 'Seu teste está esperando. Continue quando quiser.' : 'Experimente as três habilidades na plataforma vazia. Troque de personagem para descobrir seus controles.')}</p>
            {error ? <button onClick={() => window.location.reload()}>Tentar novamente ↗</button> :
              <button disabled={!initialized} onClick={event => { status === 'ready' ? game.current?.start() : game.current?.togglePause(); event.currentTarget.blur(); }}>
                {!initialized ? 'Preparando…' : status === 'paused' ? 'Continuar →' : 'Entrar no cenário →'}
              </button>}
            <div className="stack">NEXT.JS <i /> THREE.JS <i /> GSAP</div>
          </div>
        </div>
      )}
      {status === 'playing' && !error && <>
        <div className="hud"><span><b>{PLAYER_APPEARANCES[selectedPlayer].name}</b><small>{selectedPlayer === 3 ? 'Mouse · investigar e marcar' : selectedPlayer === 2 ? 'WASD + Enter' : 'WASD + E'}</small></span><button className="secondary" onClick={() => game.current?.togglePause()}>Pausar · Esc</button></div>
        <AbilityPanel state={abilities} onUse={() => game.current?.useAbility()} onTool={tool => game.current?.setAbilityTool(tool)} onStop={index => game.current?.selectStop(index)} onMap={(point, mark) => game.current?.clickAbilityMap(point, mark)} onInspect={(id, mark) => game.current?.inspectIssue(id, mark)} onReset={() => game.current?.resetAbilities()} />
        <div className="character-selector" role="group" aria-label="Escolher personagem">
          {playerIds.map(id => <button key={id} aria-pressed={selectedPlayer === id}
            onClick={event => { game.current?.selectPlayer(id); setSelectedPlayer(id); event.currentTarget.blur(); }}>
            <span className="character-color" style={{ backgroundColor: PLAYER_APPEARANCES[id].shirt }} aria-hidden="true" />
            {PLAYER_APPEARANCES[id].name}
          </button>)}
          <button aria-pressed={closeView} onClick={() => { game.current?.setCloseView(!closeView); setCloseView(!closeView); }}>
            {closeView ? 'Visão ampla' : 'Ver de perto'}
          </button>
        </div>
        {selectedPlayer !== 3 && !abilities.editing && <div className="touch-controls" aria-label="Controles de movimento">
          {directions.map(({ code, label, symbol }) => <button key={code} aria-label={label}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); game.current?.input.setTouch(event.pointerId, code); }}
            onPointerUp={event => game.current?.input.setTouch(event.pointerId)}
            onPointerCancel={event => game.current?.input.setTouch(event.pointerId)}
            onLostPointerCapture={event => game.current?.input.setTouch(event.pointerId)}
          >{symbol}</button>)}
        </div>}
      </>}
      <footer className="bottom-bar"><span>{selectedPlayer === 3 ? 'MOUSE' : 'WASD / SETAS'} <small>{selectedPlayer === 3 ? 'ANALISAR' : 'MOVER'}</small></span><span>ESC <small>PAUSAR</small></span><span className="prototype-label">HABILIDADES · SEM MISSÃO</span></footer>
    </section>
  );
}
