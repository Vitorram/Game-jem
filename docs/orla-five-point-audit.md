# Orla — validação dos cinco pontos

Base: main em `6c75ef9397b4188cb7107b36d2f1f8b566e13cb2`.
Escopo: campanha solo, avisos/menus, desempenho local, reinício e clareza das tarefas.
A sincronização integral do coop continua fora desta etapa.

## Resultado

| Ponto | Evidência | Conclusão |
| --- | --- | --- |
| Partida completa | Novo teste percorre os dez chamados por análise, acionamento, interações, habilidades e arquivamento. Final em 252.350 ms simulados, dez conclusões, nenhuma expiração. Derrota com quatro expirações e botão Jogar de novo também exercitados no navegador. | Aprovado no escopo automatizado. |
| Avisos e menus | Tablet, Q, pausa, teclas durante pausa, confirmação de perda de XP, remoção do toast e resultado/reinício exercitados no Chromium. Corrigida ação 4 repetida que desfazia o desvio no fluxo intenso. Avisos deixaram o centro e ganharam largura limitada. | Fluxos exercitados aprovados; sem afirmação de cobertura de todos os puzzles e combinações. |
| Desempenho | 3.600 atualizações de 1/60 s no Chromium: CPU média de 0,18–0,21 ms, P95 ~0,30 ms. Um quadro com 10–11 veículos tinha ~3.000 chamadas de desenho e 383–392 mil triângulos. | CPU adequada nesta amostra; renderização merece otimização e teste em GPU real. |
| Reinício e limpeza | Cinco reconstruções: sempre 5.537 objetos, 166 geometrias, 24 texturas e um canvas após renderizar. Timers estabilizaram em quatro; desmontagem final deixou zero intervalos e zero canvases. Suíte também cobre 20 trocas e setup/cleanup/setup. | Sem crescimento desses contadores nos ciclos observados. Dicas e distâncias antigas foram corrigidas. |
| Clareza | O HUD antigo retornava null em quase toda a campanha. Novo resumo cobre análise, acionamento, etapa de campo, equipe, comando, local, espera e arquivamento. Cobertura para todos os passos do catálogo. Inspeção em 1280×800 e viewport de 390×844. | Melhorado e validado visualmente; vale observar uma pessoa jogando sem orientação para confirmar compreensão. |

## Correções

- `GameObjectiveHUD.tsx`: o objetivo deixou de desaparecer durante a fase. O chamado atual passa a ter resumo persistente e detalhes expansíveis.
- `missionBrief.ts`: transforma somente progresso confirmado em instruções; não altera o estado. No resgate não anuncia que o entregador já está seguro quando ele apenas começou a atravessar.
- `Game.ts`: início/saída limpam prompt e distância. Antes, uma cena nova cujo prompt inicial era null podia não sobrescrever a dica antiga do React.
- `OrlaPhase.ts`: repetir 4 durante o fluxo intenso confirma o desvio, sem desligá-lo nem reiniciar os oito segundos. Liberar as vias com 1 preserva esse desvio enquanto a missão está ativa. Também corrigido um texto com caracteres corrompidos.
- CSS: resumo legível e com altura limitada em telas pequenas; toast com largura limitada e posicionado fora do painel de objetivo em desktop.

## Como os testes foram feitos

- `npm run typecheck`, `npm test` e `npm run build`.
- O teste novo de campanha usa os sistemas reais de trânsito, pedestres, inventário, ações e missão. Teleporta a equipe até os locais e conclui os minigames pelo callback de integração. Não demonstra a dificuldade de caminhar ou de resolver cada puzzle manualmente, nem usa `resolveRisk` para forçar etapas de missão: ele é chamado pelo evento real da fase.
- O teste de apresentação da vitória alimenta os passos pela API da sessão. Seu objetivo é validar a tela de resultado; não é contado como teste de gameplay físico.
- O navegador executou um bundle local dos componentes React e motor atuais com WebGL. O renderer foi suspenso para avançar determinados cenários e medir CPU separadamente; houve também amostra de RAF/renderização real.
- O ambiente usa Chromium com SwiftShader (renderização por software). A amostra de RAF foi de ~10 FPS em 3,08 s, com P95 de quadro de 600 ms. Isso NÃO demonstra FPS no computador do jogador e NÃO aprova a meta de 60 FPS. A quantidade de chamadas de desenho é o sinal para uma futura rodada de instancing/batching, redução de sombras e medições em hardware real.
- O viewport estreito é uma checagem de layout, não um teste em iPhone/Android físico. Não foi medida memória total do processo, somente contadores de recursos do renderer e intervalos/canvas da tela.

## Próximo passo recomendado

Testar a nova orientação com alguém que ainda não conhece as tarefas. Em seguida, medir a cena em GPU real antes de escolher uma otimização gráfica. A auditoria não adiciona snapshots de rede nem muda a arquitetura de sincronização.

## Ajuste solicitado: objetivo compacto no canto superior esquerdo

O resumo agora mostra, por padrão, apenas a equipe e uma ação curta com a tecla necessária.
Título do chamado, etapa, orientação completa e destino ficam recolhidos em “Ver detalhes”.
O painel foi reposicionado logo abaixo dos cartões de tarefa (172 px no desktop e 212 px
no viewport estreito). O teste de componente garante que os detalhes não iniciam abertos.
