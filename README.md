# Projeto Zero — base para jogo de navegador

Next.js App Router + TypeScript + Three.js direto + GSAP. Cena de teste com jogador provisório, teclado/toque, pausa e entrada de câmera. A câmera elevada é apenas uma demonstração, não define o gênero do jogo.

## Rodar

O modo online em `/coop` usa um processo separado: `npm run coop:server`.
Consulte [backend/README.md](backend/README.md) para salas públicas/privadas,
variáveis de ambiente, permissões, limites e execução em rede.

Use Node.js 22 ou 24. Na pasta do projeto:

```bash
npm ci
npm run dev
```

Abra http://localhost:3000. Clique em **Entrar no cenário**. Mova com WASD, setas ou os botões de direção. Esc pausa/retoma. Ao sair da janela, o jogo pausa e aguarda sua confirmação para continuar.

## Orla ampliada

O botão **Jogar na Orla** abre a mesma fase original, ampliada de 32 para 40 unidades de largura e mantendo 20 de profundidade. Não existe uma fase adicional de rotatória. A missão, o poste, os itens e os personagens preservam suas posições no mundo.

O cenário mantém mar, areia, calçadão, ciclovia e avenida com duas faixas por sentido, além da faixa operacional de desvio usada pela Mobilidade. O paisagismo toma como referência a Avenida Arthur Costa Filho, na orla central de Caraguatatuba. A frota inclui hatch, sedã, SUV, picape, ônibus e moto, dimensionados para as faixas da Orla.

### Pedestres e ciclistas da Orla

Os pedestres usam a mesma modelagem articulada e caminhada das personagens, com quatro aparências (coral, verde, boné e lilás). A animação acompanha a distância percorrida, suaviza as mudanças de direção e volta ao repouso quando o NPC espera na faixa.

Há três variações de ciclistas: passeio com cestinha, esportivo e entregador com bag amarela **99Food**. Todos têm capacete, mãos apoiadas no guidão, pernas pedalando e rodas que giram conforme o deslocamento. A bag acompanha o tronco do entregador. Os modelos ficam em `src/game/traffic/NpcModels.ts`; rotas e travessias ficam no `ActiveMobilitySystem.ts` da fase original.

As travessias funcionam sem semáforos e têm filas independentes. Um pedestre esperando na ciclovia solicita a parada das bicicletas; a fila da avenida não interfere nessa decisão. Na avenida, três pedestres formam um grupo e solicitam a parada dos carros. Quem já passou do ponto de parada termina de liberar a faixa antes da entrada dos pedestres. O trio atravessa junto, e os carros retomam quando todos saem. Há um intervalo mínimo de circulação de três segundos entre grupos na avenida e de 0,6 segundo entre travessias na ciclovia.

As distâncias de parada e liberação ficam em `src/game/traffic/crossingRules.ts`. `node --test tests/crossings.cjs` simula as filas separadas, a travessia em grupo e 180 segundos de circulação em dois ritmos de atualização.

## Personagens jogáveis

### Teste livre de habilidades

Na plataforma vazia de `/jogo`, cada personagem tem um painel próprio. **Infraestrutura:** WASD move; escolha Sensor ou Iluminação e pressione **E** (ou o botão do painel). Há cinco sensores de teste; a luz alterna suave, forte e desligada. **Mobilidade:** WASD move; **Enter** abre a edição, A/B/C escolhem o ponto a mover e um clique no mapa reposiciona esse ponto; Enter aplica a rota. Trocar de personagem descarta uma edição ainda não aplicada. **Análise:** use o mouse no mapa abstrato para inspecionar os três problemas simulados e marque riscos com o botão direito ou os botões do painel. Nesta tela, WASD não move a personagem.

As marcações e equipamentos permanecem ao trocar de personagem. **Reiniciar teste das três** limpa a demonstração. Não há missão, cenário urbano ou persistência após recarregar a página. `npm test` verifica também as regras das habilidades.

Em `/jogo`, escolha uma das três personagens nos botões à esquerda. Use **Ver de perto** para acompanhar os detalhes; **Visão ampla** afasta a câmera. WASD, setas e os controles de toque movimentam a personagem selecionada.

Os modelos procedurais em `Player.ts` têm ombros, cotovelos, quadris, joelhos e tornozelos articulados. A caminhada posiciona os pés com cinemática inversa de duas articulações. Respiração, piscadas, mochilas e cabelos continuam animados em repouso; cachos, mechas longas e cabelo azul têm movimentos próprios. Pausar o jogo congela as animações. Os modelos são construídos em Three.js, sem arquivos GLB externos.

Valide movimento, contato dos pés, seleção e liberação de recursos com `npm run test:characters` (Node 22.13+ ou 24).

## Itens na Fase 1 · Orla

Abra **Fase 1 · Orla** em `/jogo`. WASD/setas ou o direcional de toque movem a personagem. **E** ou **Ação · E** interage com a célula adjacente na última direção de movimento (eixo dominante nas diagonais). **T** troca a personagem; os botões de seleção continuam disponíveis.

Na Orla, a Mobilidade usa o baú laranja de cones, junto à estação. Depois de ser acionada pela Analista, aproxime-se do baú, vire-se para ele e aperte **E**: um cone aparece sobre a personagem. Leve-o até uma faixa da avenida e aperte **E** para posicioná-lo; veículos reduzem a velocidade e desviam. **E** perto de um cone já colocado recolhe-o. O inventário acompanha a personagem ao trocar de equipe; reiniciar a fase limpa os cones.

O catálogo fica em `src/game/items/itemData.ts`; as regras e direções em `ItemInteractions.ts`, sem Three.js. `orlaMap.ts` define as caixas e seus tipos; `ItemVisuals.ts` mantém os meshes e libera seus recursos no descarte da cena. Altura e tamanho dos itens ficam em `ITEM_VIEW_CONFIG`.

## Fluxo cooperativo de riscos na Orla

Há três pontos na faixa inferior do mapa: **1 · iluminação**, **2 · sensor**, **3 · rota/calçada interditada**. Um, dois ou três traços identificam os pontos no chão. A cor muda de azul (não inspecionado) para amarelo (inspecionado), vermelho (tarefa liberada), roxo (desvio em preparação) e verde (resolvido). O painel mostra o estado também em texto e pode ser recolhido.

1. Selecione **Análise**, caminhe até a célula vizinha e olhe para o ponto. **E** ou **Ação · E** inspeciona; outra ação marca o risco e libera a tarefa.
2. Troque com **T** ou os três botões de personagem. Posição, direção, itens e intervenções concluídas permanecem com suas donas.
3. **Infraestrutura** usa E no ponto marcado para instalar o sensor ou acender a iluminação. **Mobilidade** usa E no ponto de rota para preparar um desvio de teste predefinido, e E novamente para confirmar. A rota original permanece até a confirmação; trocar para outra personagem cancela só o rascunho.

O papel errado ou uma tarefa ainda não liberada não produz intervenção. Ações repetidas em um risco resolvido não duplicam equipamento nem desligam a luz. Nesta etapa, habilidades não consomem os itens carregáveis e não há pedidos, pontuação ou multiplayer em rede. Sair da fase reinicia o teste.

`AbilityActions.ts` compartilha as regras de inspeção, sensores, luz e paradas entre o laboratório e `RiskWorkflow.ts`. Este último contém a máquina de estados sem Three/React. `riskData.ts` define os três riscos e o desvio; a cena reaproveita `AbilityVisuals` para mostrar as intervenções. O React só recebe snapshots em ações, nunca por frame. `npm test` cobre o fluxo puro, papéis, troca de personagem, inventário, pausa e descarte de GPU.

## Progressão dos tutoriais

O início da Fase 1 ensina as mecânicas em blocos curtos antes de liberar a partida:

1. **Analista:** localizar a ocorrência, ler e confirmar o relatório, depois encaminhar Infraestrutura e Mobilidade.
2. **Mobilidade · sinalização:** mover-se até o baú, pegar um cone e posicioná-lo junto ao poste. A interação e o objetivo indicam cada ação.
3. **Mobilidade · circulação:** praticar os comandos 1, 2, 3 e 4 e restaurar o fluxo.
4. **Infraestrutura:** caminhar até o poste quando a área estiver livre e praticar o circuito elétrico. Depois, conhecer sensor e atendimento de colisão. O exercício não conclui a ocorrência.
5. **Desafio da Orla:** o treino é limpo, a iluminação volta ao normal e começa o relógio de seis minutos.

Assim, o tutorial pratica ações isoladas e a partida usa essas mesmas ações em conjunto. Na partida, os avisos já indicam as equipes responsáveis; a Analista acompanha e marca objetivos no tablet.

## Módulo de partida e pedidos

`src/game/session/GameSession.ts` implementa a lógica pura de partida, sem Three, React, DOM ou relógio global. A Orla usa nove eventos em intervalos de 20 segundos, com prazo de 30 segundos por missão e limite de três missões perdidas. `sessionData.ts` transforma a agenda em pedidos. O modo genérico de catálogo cíclico continua disponível para outros cenários.

- Estados: `menu` → `playing` ↔ `paused` → `finished`. `start()` inicia ou reinicia após o fim; `returnToMenu()` limpa a partida. A pausa congela fase, chegadas e prazos. Só `playing` aceita resoluções.
- Na agenda da Orla, qualquer ocorrência ativa pode receber progresso, seguindo seus passos em ordem. No modo genérico, a fila permanece FIFO. Cada instância tem ID próprio, preservado contra reutilização ao reiniciar.
- Concluir rende `basePoints + floor(maxSpeedBonus × tempoRestante / timeLimitMs)`. Etapas isoladas não pontuam. Na Orla, cada prazo expirado desconta 200 XP; três missões perdidas encerram a partida com a tela “Você perdeu”.
- Deixar a via de escape aberta por 10 segundos gera um aviso. Aos 20 segundos, desconta 200 XP; fechar e abrir novamente reinicia a contagem.
- No prazo exato, o pedido expira. No fim da fase, todas as pendências também expiram com penalidade; nenhuma chegada acontece no instante final. Empates processam expiração antes de chegada.
- `advance(deltaMs)` recebe milissegundos, inclusive frações, e processa todos os eventos de avanços grandes. Use o tempo real decorrido enquanto jogando, sem o limite de delta usado na física. Avance o relógio antes de registrar uma resolução. Não repasse tempo passado em pausa após retomar.
- Métodos retornam eventos de mudança; `snapshot()` devolve uma cópia com fila, próximo risco, relógios, placar e contadores. Não há callbacks ou atualizações React por frame, nem recursos de GPU a descartar.

Exemplo de uso em lógica sem renderização:

```ts
import { GameSession } from './src/game/session/GameSession';
import { ORLA_SESSION_CONFIG } from './src/game/session/sessionData';

const session = new GameSession(ORLA_SESSION_CONFIG);
session.start();
session.advance(37_000);
const order = session.snapshot().orders[0];
// Depois de concluir o circuito elétrico no cenário:
session.resolveRisk(order.id, 101);
// A fase continua mesmo se todas as ocorrências já emitidas estiverem resolvidas.
session.pause();
session.advance(60_000); // Pausado: não altera relógios nem pedidos.
session.resume();
```

`OrlaPhase.ts` integra agenda, avisos, interações e consequências no cenário. `sessionStore.resolveEvent` registra apenas intervenções confirmadas. `npm test` cobre horários, recuperação, pausa, reinício, papéis, filas, cone, desvio, circuito e instalação. Os testes antigos de `RiskWorkflow` continuam cobrindo o módulo independente de riscos.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `src/app/` | Rotas, layout, metadata e estilos globais do Next |
| `src/components/game/GameLoader.tsx` | Fronteira cliente e carregamento dinâmico sem SSR |
| `src/components/game/GameCanvas.tsx` | Montagem/desmontagem do motor, menu, HUD e botões de toque |
| `src/game/core/Game.ts` | Renderer, câmera, loop, resize e pausa |
| `src/game/core/Input.ts` | Teclado e entradas de toque |
| `src/game/scenes/TestScene.ts` | Mundo demonstrativo, luzes e recursos da cena |
| `src/game/entities/Player.ts` | Objeto do jogador e movimento |
| `src/game/config.ts` | Velocidade, limites e qualidade |
| `src/app/teste-personagem/` | Rota isolada da bancada de personagens (`/teste-personagem`) |
| `src/components/character-test/` | Visualizador 3D, carregamento e controles da bancada |
| `public/assets/characters/` | Personagens `.glb` e `.gltf`; o arquivo padrão é `personagem.glb` |
| `public/assets/models/` | Outros modelos 3D reutilizáveis (`.glb` e `.gltf`) |
| `public/assets/textures/` | Texturas e materiais |
| `public/assets/ui/` | Imagens e elementos visuais da interface |

Arquivos em `public` são acessados sem o prefixo `public`: `/assets/characters/personagem.glb`.
Abra `/teste-personagem` para experimentar um modelo local `.glb` ou `.gltf`, ou coloque-o em `public/assets/characters/personagem.glb` para carregá-lo como padrão. WASD/setas movem o personagem; se o arquivo tiver animação embutida, a bancada tenta usar a primeira animação de caminhada ou corrida.

## Como desenvolver

O Next renderiza a página e a interface. O motor é instanciado em `useEffect`, apenas no navegador. A posição do jogador é atualizada pelo loop do Three, sem `setState` a cada frame. React recebe apenas mudanças da interface, como pausa e início.

GSAP anima a câmera e os painéis. O movimento jogável usa delta time e normaliza diagonais. Pausa também interrompe a animação de câmera. A desmontagem cancela o loop e tweens, remove eventos e libera os recursos atuais de GPU, inclusive no ciclo extra do React Strict Mode.

Comece alterando `TestScene.ts` e `Player.ts`. Quando houver uma segunda fase, extraia um contrato de cena (`update` / `dispose`) e um gerenciador de troca. Adicione um carregador/cache de assets quando houver modelos reais; o dono desse cache deverá liberar texturas e modelos compartilhados. Física, áudio, persistência, multiplayer e assets finais ainda não estão implementados.

## Validar e gerar build

```bash
npm run typecheck
npm run build
npm start
```

A saída padrão do Next fica em `.next`. Não configure a saída como `dist`.

## Publicar na Vercel

1. Extraia este projeto e suba o conteúdo da pasta em um repositório Git.
2. Importe esse repositório em **Add New → Project** na Vercel.
3. Se o projeto estiver em uma subpasta, selecione essa pasta em **Root Directory**.
4. Use o preset **Next.js** e Node.js **22.x** ou **24.x**.
5. Mantenha a saída padrão do preset; o comando de build é `npm run build`.
6. Publique. Novos pushes na branch configurada geram novos deploys.

Também é possível publicar usando a CLI oficial da Vercel, após autenticar sua conta. Este pacote só prepara o projeto; nenhum deploy foi realizado.

## Próximas decisões

Definir perspectiva (top-down, terceira pessoa ou outra), controles principais e o primeiro objetivo do jogador. Depois substituir o objeto provisório por um modelo e construir uma fase pequena.

## Referências oficiais

- https://nextjs.org/docs/app/guides/lazy-loading
- https://vercel.com/docs/frameworks/full-stack/nextjs
- https://threejs.org/docs/
- https://gsap.com/docs/v3/


### Rodada jogável da Orla

Em `/jogo`, conclua o treino guiado. A rodada dura **seis minutos completos**;
resolver uma ocorrência não encerra a fase. Cada missão vale 100 XP e até 50 de
bônus, tem 30 segundos para ser concluída e perde 200 XP quando vence o prazo.
Três missões perdidas encerram a rodada.

| Horário | Evento e resposta |
| --- | --- |
| 0:10 | Pane urgente no semáforo, com faíscas, balão e take de câmera; os carros param. **Infraestrutura:** E no semáforo e puzzle de reparo. |
| 0:30 | Fluxo intenso. **Mobilidade:** abrir faixas e desvio (1 e 4), mantendo circulação por 8 s. |
| 0:50 | Ciclista precisa de ajuda. **Mobilidade:** 3 para parar os carros, aguardar a travessia e 1 para liberar. |
| 1:10 | Checagem rápida do semáforo. **Infraestrutura:** E para confirmar o controlador. |
| 1:30 | Objeto bloqueia a ciclovia. **Mobilidade:** E perto dos objetos para iniciar a triagem. |
| 1:50 | Cone aparece no meio da ciclovia. **Mobilidade:** recolher com E e levar até a caixa de cones. |
| 2:10 | Batida leve entre dois carros, com fumaça e take de câmera. **Mobilidade:** cone e desvio. **Infraestrutura:** E ao lado dos carros para liberar a faixa. |
| 2:30 | Falha de sensor. **Infraestrutura:** E no ponto e permanecer durante a instalação. |
| 2:50 | Poste apagado. **Infraestrutura:** E no poste e puzzle de circuito. |

Entre chamados, as três equipes podem circular livremente. A chegada de uma ocorrência seleciona a Analista no modo solo; o tablet é aberto manualmente com **Q** ou **Abrir tablet**. O botão sinaliza chamados aguardando análise ou arquivamento. Ao acionar o reforço no solo, o controle passa para a equipe responsável.

O HUD mostra responsáveis, próximos passos, pedestres esperando e carros parados.
**Marcar objetivo** escolhe a seta da ocorrência. Avisos mudam de cor com a espera;
filas e perda de bônus tornam a demora perceptível. As teclas também têm botões de toque.

**Controles:** WASD/setas para mover, Shift para correr, T para trocar de equipe,
E para interagir e Esc para pausar. A Analista também anda e corre: **Q** ou o botão na tela abre/guarda seu tablet. Enquanto usa o tablet, fica parada no próprio local; trânsito, colisões e relógio continuam funcionando. Ao guardar, pode voltar a andar, sem ser transportada para a cabine. Durante a orientação inicial da Analista, o tablet permanece aberto até concluir ou pular o treino. No cooperativo, cada pessoa mantém sua própria equipe.
No celular há botões de direção, corrida e ações das vias. Usar os botões de personagens
seleciona a equipe; o anel no chão identifica quem está sob controle.

O movimento da Orla usa a mesma velocidade direta do laboratório: 1,8 unidades/s,
com Shift a 1,45×, além das colisões com deslizamento do mapa. O relógio conta tempo real
(inclusive durante o reparo), mas congela ao pausar ou sair da janela. O puzzle
preserva a etapa e pausa suas animações e callbacks.

**Validação manual:** confira movimento diagonal, corrida, colisão em bancadas,
troca de equipe sem deslocar a anterior, pausa por Esc e ao sair da janela,
zoom/resize, vitória, tempo esgotado e reinício com poste, cones e placar limpos.
Repita em celular e confirme que os controles não cobrem o alvo. Verifique também
`/teste-personagem`. Os testes automatizados usam Three.js com renderer simulado;
não substituem a inspeção visual nem uma medição de desempenho em aparelho real.
