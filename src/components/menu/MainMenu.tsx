'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import AnimatedMenuScene from './AnimatedMenuScene';

import AudioControls from '../audio/AudioControls';
import { useGameAudio } from '@/game/audio/useGameAudio';

type MenuPanel = 'settings' | 'credits' | null;

const menuIconPaths = {
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  coop: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.4 2.7-5.2 5.5-5.2s4.9 1.8 5.5 5.2" /><circle cx="16.5" cy="9" r="2.6" /><path d="M15.8 13.9c2.4.1 4.1 1.7 4.7 4.6" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.3" /><circle cx="9" cy="17" r="2.3" /></>,
  credits: <><path d="M12 6.5C10 5 7.2 4.6 4 5v13c3.2-.4 6 0 8 1.5 2-1.5 4.8-1.9 8-1.5V5c-3.2-.4-6 0-8 1.5z" /><path d="M12 6.5v13" /></>,
};

function MenuIcon({ name }: { name: keyof typeof menuIconPaths }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{menuIconPaths[name]}</svg>;
}

export default function MainMenu() {
  useGameAudio({ screen: 'menu', status: 'ready', preparing: false });
  const scene = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [activePanel, setActivePanel] = useState<MenuPanel>(null);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(preference.matches);
    sync();
    preference.addEventListener('change', sync);
    try { setEffectsEnabled(localStorage.getItem('cidade-segura-menu-effects') !== 'off'); } catch {}
    return () => preference.removeEventListener('change', sync);
  }, []);

  const toggleEffects = () => {
    const enabled = !effectsEnabled;
    setEffectsEnabled(enabled);
    try { localStorage.setItem('cidade-segura-menu-effects', enabled ? 'on' : 'off'); } catch {}
  };

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const context = gsap.context(() => {
      gsap.from('.menu-brand', {
        opacity: 0, y: 18, duration: reduceMotion ? 0 : 0.85, stagger: 0.16, delay: 0.2, ease: 'power3.out',
      });
      gsap.from('.menu-action', {
        opacity: 0, x: -24, duration: reduceMotion ? 0 : 0.65, stagger: 0.12, delay: 0.65, ease: 'power3.out',
      });
    }, scene);
    return () => context.revert();
  }, []);

  useEffect(() => {
    if (!activePanel || !panel.current) return;
    dialog.current?.showModal();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const context = gsap.context(() => {
      gsap.fromTo(panel.current, { opacity: 0, y: 16, scale: 0.98 }, {
        opacity: 1, y: 0, scale: 1, duration: reduceMotion ? 0 : 0.35, ease: 'power2.out',
      });
    }, panel);
    return () => context.revert();
  }, [activePanel]);

  return (
    <main ref={scene} className="main-menu" aria-label="Menu SUBURBAN">
      <AnimatedMenuScene animated={effectsEnabled && !reducedMotion} />
      <div className="menu-shade" aria-hidden="true" />

      <div className="menu-layout">
        <header className="menu-heading">
          <h1 className="menu-brand">
            {/* O adesivo gira por `rotate` para não brigar com o `transform` que o GSAP anima no h1. */}
            <span className="menu-logo-sticker">
              <Image className="menu-logo" src="/assets/ui/logo.png" alt="SUBURBAN" width={1376} height={768} loading="eager" fetchPriority="high" />
            </span>
          </h1>
          <p className="menu-brand menu-tagline">Planejamento urbano e tecnologia por uma cidade mais segura.</p>
        </header>

        <nav ref={menu} className="menu-controls" aria-labelledby="menu-controls-title">
          <h2 id="menu-controls-title" className="menu-kicker">Menu principal</h2>
          <div className="menu-actions">
            <Link className="menu-action menu-action-primary" href="/jogo">
              <span className="menu-icon" aria-hidden="true"><MenuIcon name="play" /></span><span>Iniciar</span><span className="menu-arrow" aria-hidden="true">→</span>
            </Link>
            <Link className="menu-action" href="/coop">
              <span className="menu-icon" aria-hidden="true"><MenuIcon name="coop" /></span><span>Jogar em coop</span><span className="menu-arrow" aria-hidden="true">→</span>
            </Link>
            <button className="menu-action" type="button" onClick={() => setActivePanel('settings')}>
              <span className="menu-icon" aria-hidden="true"><MenuIcon name="settings" /></span><span>Configurações</span><span className="menu-arrow" aria-hidden="true">＋</span>
            </button>
            <button className="menu-action" type="button" onClick={() => setActivePanel('credits')}>
              <span className="menu-icon" aria-hidden="true"><MenuIcon name="credits" /></span><span>Créditos</span><span className="menu-arrow" aria-hidden="true">＋</span>
            </button>
          </div>
          {/* Faixa de pedra portuguesa: o calçadão da Orla como acabamento do cartão. */}
          <div className="menu-mosaic" aria-hidden="true" />
        </nav>
      </div>


      {activePanel && (
        <dialog ref={dialog} className="menu-dialog-backdrop" aria-labelledby="dialog-title" onCancel={() => setActivePanel(null)} onClick={event => { if (event.target === event.currentTarget) setActivePanel(null); }}>
          <section ref={panel} className="menu-dialog">
            <button className="dialog-close" type="button" aria-label="Fechar" onClick={() => setActivePanel(null)}>×</button>
            {activePanel === 'settings' ? <>
              <span className="dialog-eyebrow">PREFERÊNCIAS</span>
              <h2 id="dialog-title">Configurações</h2>
              <p className="dialog-intro">Ajustes disponíveis para esta versão.</p>
              <div className="setting-row menu-effects-setting">
                <div><b>Animações do cenário</b><small>Folhas, cabelos, luzes e letreiro</small></div>
                <button type="button" className="effects-toggle" aria-pressed={effectsEnabled} onClick={toggleEffects}>{effectsEnabled ? 'Ativadas' : 'Pausadas'}</button>
              </div>
              <AudioControls />
              <p className="settings-note">{reducedMotion ? 'Seu dispositivo prefere movimento reduzido. As animações ficam pausadas automaticamente.' : 'Sua preferência fica salva neste navegador.'}</p>
            </> : <>
              <span className="dialog-eyebrow">QUEM FAZ A CIDADE</span>
              <h2 id="dialog-title">Créditos</h2>
              <p className="dialog-intro">Uma experiência sobre mobilidade urbana, tecnologia e segurança para todas.</p>
              <div className="credits-card"><span className="credits-symbol">✳</span><div><b>SUBURBAN</b><small>Projeto acadêmico · 2026</small></div></div>
              <div className="credits-list"><span>IDEIA E DESENVOLVIMENTO</span><b>Equipe SUBURBAN</b><span>TECNOLOGIA</span><b>Next.js · Three.js · GSAP</b></div>
            </>}
            <button className="dialog-done" type="button" onClick={() => setActivePanel(null)}>Voltar ao menu</button>
          </section>
        </dialog>
      )}
    </main>
  );
}

