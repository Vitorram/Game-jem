import type { RiskSnapshot } from '@/game/risks/RiskWorkflow';
import { RISK_STATUS_LABELS } from '@/game/risks/riskData';
import type { PlayerId } from '@/game/entities/Player';

type Props = { state: RiskSnapshot; player: PlayerId };
const roleHelp = {
  1: 'Infraestrutura: E instala sensor ou acende a luz de um risco marcado.',
  2: 'Mobilidade: E prepara o desvio marcado; E novamente confirma.',
  3: 'Análise: E inspeciona o ponto; E novamente marca e libera a tarefa.',
};

export default function RiskPanel({ state, player }: Props) {
  return <aside className="risk-panel" aria-label="Riscos da Orla">
    <details open>
      <summary>Riscos da Orla · teste cooperativo</summary>
      <p>{roleHelp[player]} Fique ao lado, olhando para o ponto.</p>
      <ol>
        {state.risks.map(risk => <li key={risk.id} data-status={risk.status}>
          <b>Ponto {risk.id}{risk.status !== 'hidden' ? ` · ${risk.title}` : ''}</b>
          <span>{RISK_STATUS_LABELS[risk.status]}{risk.status === 'released' ? ` · ${risk.kind === 'route' ? 'Mobilidade' : 'Infraestrutura'}` : ''}</span>
        </li>)}
      </ol>
      <small>Os traços no chão identificam os pontos 1, 2 e 3. Tab ou os botões trocam a personagem.</small>
    </details>
    <p className="risk-message" role="status" aria-live="polite">{state.message}</p>
  </aside>;
}
