'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import AnimatedMenuScene from './AnimatedMenuScene';

type MenuPanel = 'settings' | 'credits' | null;

export default function MainMenu() {
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

      <header className="menu-heading">
        <h1 className="menu-brand">SUBURBAN</h1>
      </header>

      <div ref={menu} className="menu-controls">
        <div className="menu-actions">
          <Link className="menu-action menu-action-primary" href="/jogo">
            <span className="menu-icon" aria-hidden="true">▶</span><span>Iniciar</span><span className="menu-arrow" aria-hidden="true">↗</span>
          </Link>
          <button className="menu-action" type="button" onClick={() => setActivePanel('settings')}>
            <span className="menu-icon" aria-hidden="true">⚙</span><span>Configurações</span><span className="menu-arrow" aria-hidden="true">＋</span>
          </button>
          <button className="menu-action" type="button" onClick={() => setActivePanel('credits')}>
            <span className="menu-icon menu-book" aria-hidden="true">▤</span><span>Créditos</span><span className="menu-arrow" aria-hidden="true">＋</span>
          </button>
        </div>
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
