'use client';

export type MobilityTutorialStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18;

type Props = {
  step: MobilityTutorialStep;
  onBegin: () => void;
  onContinue: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

const lessons: Partial<Record<MobilityTutorialStep, { eyebrow: string; title: string; body: string; button: string; key?: string }>> = {
  0: { eyebrow: 'MOBILIDADE · TREINO GUIADO', title: 'Vamos preparar o trecho', body: 'As instruções aparecem neste cartão, uma ação por vez. Você pode andar e explorar a Orla enquanto lê.', button: 'Mostrar objetivo do baú' },
  2: { eyebrow: 'MECÂNICA 1 · PEGAR CONE', title: 'Pegue o cone do baú', body: 'Fique de frente para o baú e pressione E ou toque em Cone. O cone vai acompanhar a personagem.', button: 'Entendi', key: 'E' },
  4: { eyebrow: 'MECÂNICA 2 · LEVAR O CONE', title: 'Leve o cone até o poste', body: 'Siga a seta até a faixa indicada junto ao poste danificado. A próxima instrução aparece quando você chegar ao ponto de trabalho.', button: 'Entendi · mostrar caminho' },
  6: { eyebrow: 'MECÂNICA 3 · POSICIONAR CONE', title: 'Proteja a área de trabalho', body: 'No local indicado, pressione E ou Cone para colocar a sinalização na via. Os veículos vão reduzir a velocidade e desviar.', button: 'Entendi', key: 'E' },
  8: { eyebrow: 'HABILIDADE 1 DE 4 · TECLA 1', title: 'Liberar vias principais', body: 'Abre as vias no sentido normal e encerra um desvio temporário de elétricos. Use para retomar a circulação padrão.', button: 'Mostrar habilidade' },
  10: { eyebrow: 'HABILIDADE 2 DE 4 · TECLA 2', title: 'Bloquear um sentido', body: 'Interrompe o sentido da via em que você está. O sentido oposto continua aberto.', button: 'Mostrar habilidade' },
  12: { eyebrow: 'HABILIDADE 3 DE 4 · TECLA 3', title: 'Interditar vias principais', body: 'Fecha todos os sentidos principais. Use quando a área exigir uma interrupção completa.', button: 'Mostrar habilidade' },
  14: { eyebrow: 'HABILIDADE 4 DE 4 · TECLA 4', title: 'Avenida verde de elétricos', body: 'Esta faixa verde é exclusiva para carros elétricos. Eles param nos carregadores e o círculo ao redor do carro mostra a carga. Se um carregador quebrar e formar fila, use a Habilidade 4 (tecla 4) para desviá-los para a rua normal.', button: 'Mostrar habilidade' },
  16: { eyebrow: 'PRÁTICA FINAL · TECLA 1', title: 'Restaure a circulação', body: 'Use 1 para deixar as vias principais no sentido normal e encerrar o desvio temporário dos elétricos.', button: 'Mostrar habilidade' },
  18: { eyebrow: 'TREINO CONCLUÍDO', title: 'Você praticou todas as habilidades', body: 'Aprendeu a sinalizar, liberar, bloquear um sentido, interditar as vias e desviar carros elétricos da avenida verde quando necessário. Agora pode combinar essas ações com as demais equipes nas ocorrências da Orla.', button: 'Começar desafio' },
};

export default function MobilityTutorialGuide({ step, onBegin, onContinue, onComplete, onSkip }: Props) {
  const lesson = lessons[step];
  if (!lesson) return null;
  const isLast = step === 18;
  const isFirst = step === 0;
  const completed = step === 18 ? 10 : Math.floor(step / 2) + 1;

  return <>
    <aside className="analyst-guide-card mobility-guide-card is-docked" aria-live="polite" aria-label="Tutorial guiado da equipe de Mobilidade">
      <div className="analyst-guide-head">
        <span className="analyst-guide-avatar mobility-guide-avatar" aria-hidden="true">M</span>
        <span><small>{lesson.eyebrow}</small><b>{isFirst ? 'ORIENTAÇÃO' : isLast ? 'CONCLUÍDO' : `ETAPA ${completed} DE 10`}</b></span>
        <div className="analyst-guide-progress" aria-label={`Etapa ${completed} de 10`}>{Array.from({ length: 10 }, (_, i) => <i key={i} data-done={i < completed || undefined} />)}</div>
      </div>
      <h2>{lesson.title}</h2>
      <p>{lesson.body}</p>
      {lesson.key && <kbd className="mobility-guide-key">{lesson.key}</kbd>}
      <button className="analyst-guide-button" onClick={isFirst ? onBegin : isLast ? onComplete : onContinue}>{lesson.button} <span aria-hidden="true">→</span></button>
      <small className="analyst-guide-required">Você pode andar com WASD ou as setas enquanto lê. O relógio só começa depois do treino.</small>
      <button type="button" className="analyst-guide-skip" aria-keyshortcuts="P" onClick={onSkip}>Pular tutorial <kbd>P</kbd></button>
    </aside>
  </>;
}
