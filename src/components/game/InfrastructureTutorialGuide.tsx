'use client';

export type InfrastructureTutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type Props = {
  step: InfrastructureTutorialStep;
  onBegin: () => void;
  onContinue: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

const lessons: Partial<Record<InfrastructureTutorialStep, { eyebrow: string; title: string; body: string; button: string; key?: string }>> = {
  0: {
    eyebrow: 'INFRAESTRUTURA · TREINO GUIADO',
    title: 'Vamos recuperar a energia',
    body: 'A área já foi protegida pela Mobilidade. Encontre o poste danificado; quando o local estiver livre, você poderá abrir a oficina elétrica.',
    button: 'Mostrar objetivo',
  },
  2: {
    eyebrow: 'MECÂNICA · REPARO ELÉTRICO',
    title: 'Abra a oficina do poste',
    body: 'Com o círculo de trabalho livre, pressione E. Na oficina, gire os conectores para levar energia da fonte até a lâmpada. Esta é uma prática: o reparo real ficará para o desafio.',
    button: 'Entendi · liberar interação',
    key: 'E',
  },
  4: {
    eyebrow: 'HABILIDADE · SENSOR',
    title: 'Instale sensores nos pontos marcados',
    body: 'Quando aparecer o alerta de monitoramento, siga a seta e pressione E no sensor. Fique perto por quatro segundos para terminar a instalação. Se sair, o serviço pausa e continua ao voltar.',
    button: 'Próxima habilidade',
  },
  5: {
    eyebrow: 'HABILIDADE · RESPOSTA EM EQUIPE',
    title: 'Libere veículos com segurança',
    body: 'Na colisão leve, Mobilidade coloca o cone e abre o desvio. Depois, aproxime-se com Infraestrutura, pressione E e permaneça por três segundos para liberar o veículo.',
    button: 'Concluir orientação',
  },
  6: {
    eyebrow: 'TREINO CONCLUÍDO',
    title: 'Infraestrutura pronta',
    body: 'A fase dura até seis minutos e os chamados chegam um de cada vez. Poste, sensor e checagem do semáforo pedem Infraestrutura; fluxo intenso, resgate do entregador e ciclovia pedem Mobilidade. Semáforo quebrado, colisão e carregador pedem as duas equipes.',
    button: 'Começar desafio',
  },
};

export default function InfrastructureTutorialGuide({ step, onBegin, onContinue, onComplete, onSkip }: Props) {
  const lesson = lessons[step];
  if (!lesson) return null;
  const complete = step === 6;
  const progress = step === 0 ? 1 : step === 6 ? 4 : step === 4 ? 2 : step === 5 ? 3 : 2;
  return <>
    <div className="analyst-guide-scrim mobility-guide-scrim" aria-hidden="true" />
    <aside className="analyst-guide-card mobility-guide-card" aria-live="polite" aria-label="Tutorial guiado da equipe de Infraestrutura">
      <div className="analyst-guide-head">
        <span className="analyst-guide-avatar infrastructure-guide-avatar" aria-hidden="true">I</span>
        <span><small>{lesson.eyebrow}</small><b>{complete ? 'CONCLUÍDO' : `ETAPA ${progress} DE 4`}</b></span>
        <div className="analyst-guide-progress" aria-label={`Etapa ${progress} de 4`}>{[1, 2, 3, 4].map(item => <i key={item} data-done={item <= progress || undefined} />)}</div>
      </div>
      <h2>{lesson.title}</h2>
      <p>{lesson.body}</p>
      {lesson.key && <kbd className="mobility-guide-key">{lesson.key}</kbd>}
      <button className="analyst-guide-button" onClick={step === 0 ? onBegin : complete ? onComplete : onContinue}>{lesson.button} <span aria-hidden="true">→</span></button>
      <small className="analyst-guide-required">A personagem e o relógio ficam parados nesta instrução.</small>
      <button type="button" className="analyst-guide-skip" onClick={onSkip}>Pular tutorial</button>
    </aside>
  </>;
}
