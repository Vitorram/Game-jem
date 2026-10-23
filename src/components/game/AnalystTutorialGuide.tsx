'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { AnalystTutorialStep } from './OrlaTablet';

type Props = {
  step: AnalystTutorialStep;
  onBegin: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

type TargetRect = { top: number; right: number; bottom: number; left: number; width: number; height: number };
type GuideLayout = { width: number; height: number; card: { left: number; top: number; width: number; height: number }; target: TargetRect | null };

const lessons = [
  { title: 'Esta é a central da Analista', body: 'No mapa ela localiza problemas. No relatório avalia cada ocorrência. No plano de resposta, escolhe e aciona as equipes.' },
  { title: 'Localize a ocorrência', body: 'O alerta está marcado na lista. Selecione o cartão “Poste danificado” para abrir o relatório de campo.' },
  { title: 'Confirme o que será atendido', body: 'Leia o relatório. Quando reconhecer o problema e o local, use o botão destacado para confirmar a ocorrência.' },
  { title: 'Organize a resposta', body: 'O poste exige reparo elétrico e proteção do trecho. Acione Infraestrutura pelo plano de resposta.' },
  { title: 'Complete o plano', body: 'Agora acione Mobilidade para proteger o trecho. O tablet mostrará cada equipe como “a caminho”.' },
  { title: 'Analista pronta', body: 'Você já sabe localizar, avaliar, confirmar e encaminhar uma ocorrência. Agora vamos aprender a preparar o trecho com a equipe de Mobilidade. O relógio continua parado.' },
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function AnalystTutorialGuide({ step, onBegin, onComplete, onSkip }: Props) {
  const cardRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<GuideLayout | null>(null);
  const isInteractiveStep = step >= 1 && step <= 4;
  const lesson = lessons[step];

  useLayoutEffect(() => {
    const measure = () => {
      const card = cardRef.current;
      if (!card) return;
      const cardBox = card.getBoundingClientRect();
      const targetElement = isInteractiveStep
        ? document.querySelector<HTMLElement>('[data-tutorial-target="true"]')
        : null;
      const targetBox = targetElement?.getBoundingClientRect();
      const target = targetBox ? {
        top: Math.max(0, targetBox.top - 7),
        right: Math.min(window.innerWidth, targetBox.right + 7),
        bottom: Math.min(window.innerHeight, targetBox.bottom + 7),
        left: Math.max(0, targetBox.left - 7),
        width: Math.min(window.innerWidth, targetBox.right + 7) - Math.max(0, targetBox.left - 7),
        height: Math.min(window.innerHeight, targetBox.bottom + 7) - Math.max(0, targetBox.top - 7),
      } : null;

      const width = window.innerWidth;
      const height = window.innerHeight;
      const cardWidth = cardBox.width;
      const cardHeight = cardBox.height;
      let left = (width - cardWidth) / 2;
      let top = (height - cardHeight) / 2;
      if (target) {
        left = clamp(target.left + target.width / 2 - cardWidth / 2, 12, width - cardWidth - 12);
        top = target.top > height * 0.54
          ? target.top - cardHeight - 18
          : target.bottom + 18;
        top = clamp(top, 12, height - cardHeight - 12);
      }
      setLayout({ width, height, card: { left, top, width: cardWidth, height: cardHeight }, target });
    };

    measure();
    const resize = new ResizeObserver(measure);
    if (cardRef.current) resize.observe(cardRef.current);
    const tablet = document.querySelector('.orla-tablet');
    if (tablet) resize.observe(tablet);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, isInteractiveStep]);

  const panels = layout?.target ? [
    { top: 0, left: 0, width: layout.width, height: layout.target.top },
    { top: layout.target.top, left: 0, width: layout.target.left, height: layout.target.height },
    { top: layout.target.top, left: layout.target.right, width: layout.width - layout.target.right, height: layout.target.height },
    { top: layout.target.bottom, left: 0, width: layout.width, height: layout.height - layout.target.bottom },
  ] : layout ? [{ top: 0, left: 0, width: layout.width, height: layout.height }] : [];

  return <>
    {panels.map((panel, index) => <div key={`${step}-${index}`} className="analyst-guide-scrim" style={panel} aria-hidden="true" />)}
    <aside
      ref={cardRef}
      className={`analyst-guide-card${isInteractiveStep ? ' is-interactive' : ' is-intro'}${layout?.target && layout.card.top < layout.target.top ? ' is-above' : ''}`}
      style={layout ? { left: layout.card.left, top: layout.card.top } : undefined}
      aria-live="polite"
      aria-label="Tutorial obrigatório da Analista"
    >
      <div className="analyst-guide-head">
        <span className="analyst-guide-avatar" aria-hidden="true">A</span>
        <span><small>ANALISTA · CENTRAL DA ORLA</small><b>{step === 0 ? 'Vamos conhecer seu trabalho' : step === 5 ? 'Muito bem, equipe!' : `ETAPA ${step} DE 4`}</b></span>
        {step > 0 && <div className="analyst-guide-progress" aria-label={step < 5 ? `Etapa ${step} de 4` : 'Quatro etapas concluídas'}>{[1, 2, 3, 4].map(item => <i key={item} data-done={item <= step || undefined} />)}</div>}
      </div>
      <h2>{lesson.title}</h2>
      <p>{lesson.body}</p>
      {step === 0 && <button className="analyst-guide-button" onClick={onBegin}>Começar orientação <span aria-hidden="true">→</span></button>}
      {step === 5 && <button className="analyst-guide-button" onClick={onComplete}>Continuar para Mobilidade <span aria-hidden="true">→</span></button>}
      {isInteractiveStep && <small className="analyst-guide-hint">Use somente o item iluminado para continuar.</small>}
      {(step === 0 || step === 5) && <small className="analyst-guide-required">Esta orientação faz parte do início da fase.</small>}
      <button type="button" className="analyst-guide-skip" aria-keyshortcuts="P" onClick={onSkip}>Pular tutorial <kbd>P</kbd></button>
    </aside>
  </>;
}
