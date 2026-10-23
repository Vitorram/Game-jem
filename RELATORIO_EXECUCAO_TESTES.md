# Relatório de Execução de Testes — Problemas e Soluções por Etapa
**Projeto:** Game-jem · **Data da execução:** 23/10/2026 · **Base:** commit `a621fcf` (branch `main`)
**Origem:** execução do plano em [PLANO_DE_TESTES_E_ANALISE_UI_UX.md](PLANO_DE_TESTES_E_ANALISE_UI_UX.md)

> **Status (atualizado):** Etapas 1 e 2 **concluídas**; Etapa 3 **parcialmente concluída** (CT-2.2, CT-2.3, CT-3.1, CT-3.2, CT-4.1, CT-5.3 e CT-6.2). `npm test`: **107/107** (antes: 74 aprovados, 14 falhando) e `tsc --noEmit` sem erros. Veja as seções 4 a 8 no fim do documento.

---

## 1. Resultado da execução (P0 — Baseline)

Cada arquivo foi executado isoladamente com `node --test tests/<arquivo>.cjs`.

| Arquivo | Resultado | Falhas |
|---|---|---|
| `grid-map.cjs` | ✅ 8/8 | — |
| `items.cjs` | ✅ 7/7 | — |
| `movement.cjs` | ✅ 4/4 | — |
| `player.cjs` | ✅ 11/11 | — |
| `risks.cjs` | ✅ 7/7 | — |
| `crossings.cjs` | ❌ 2/5 | 3 |
| `session.cjs` | ❌ 13/15 | 2 |
| `scenes.cjs` | ❌ 22/26 | 4 |
| `orla-phase.cjs` | ❌ 0/5 | 5 |
| **Total** | **74 aprovados · 14 falhando** | |

Os 14 testes falhando têm **duas causas raiz independentes** (A e B abaixo). O plano original atribuía tudo ao `orlaEvents.ts`; a execução mostra que as falhas de `crossings.cjs` vêm de outro lugar.

---

## 2. Ordem de correção recomendada

```
Etapa 1 (Causa A: cronograma de eventos)  ──►  Etapa 2 (Causa B: travessia)  ──►  Etapa 3 (reexecução + CTs pendentes)
```

A Etapa 1 vem primeiro porque destrava 11 dos 14 testes e porque `orla-phase.cjs` (a rodada de 6 minutos) só pode validar a Etapa 2 depois de estar verde.

---

## ETAPA 1 — Cronograma de eventos da Orla × testes (11 falhas)

### Problema A — Testes descrevem 6 eventos; o código define 10
**Arquivos afetados:** `session.cjs` (2), `scenes.cjs` (4), `orla-phase.cjs` (5)

**Evidência**
- [orlaEvents.ts](src/game/session/orlaEvents.ts) define **10 eventos**: `traffic-signal-failure` 10s, `rush-hour` 30s, `cyclist-assist` 50s, `signal-check` 70s, `bike-lane-cleanup` 90s, `bike-lane-cone` 110s, `minor-collision` 130s, `sensor-failure` 150s, `broken-light-pole-1` 170s, `ev-charger-repair` 190s.
- Os testes assumem **6 eventos** em 30s, 85s, 150s, 190s, 215s e 280s, com `broken-light-pole-1` como primeiro pedido ([session.cjs:247](tests/session.cjs#L247), [scenes.cjs:627](tests/scenes.cjs#L627), [orla-phase.cjs:41](tests/orla-phase.cjs#L41)).
- `ORLA_SESSION_CONFIG` ([sessionData.ts](src/game/session/sessionData.ts)) é derivado de `ORLA_EVENTS`, então qualquer mudança no cronograma propaga direto para a sessão.

**Sintomas observados**
| Teste | Erro |
|---|---|
| `session`: cinco eventos nos horários exatos | `orders.length` 1, esperado 0 (evento chega aos 10s, antes do esperado) |
| `session`: eventos fora de ordem | `orders.length` 0, esperado 6 |
| `orla-phase`: todos os 5 | `TypeError: Cannot read properties of undefined (reading 'stage' / 'status')` — `problem('broken-light-pole-1')` ainda não existe aos 30s |
| `scenes`: treino mantém relógio em zero | `actual: 1, expected: 0` — pedido já na fila |
| `scenes`: prazo encerra ações | `actual: 3, expected: 6` |
| `scenes`: fase real | `[]` em vez de `['infraestrutura']` |
| `scenes`: E/toque interagem | `[2,2,3,1,2]` em vez de `[3,2,3,1,2]` |

**Decisão necessária antes de corrigir (cabe ao time):** qual lado é a fonte da verdade?

| Opção | O que fazer | Quando escolher |
|---|---|---|
| **A1 — Código é o correto** (10 eventos são intencionais) | Reescrever as expectativas dos testes para o novo cronograma; atualizar `maxExpiredOrders`, contagens (6→10) e os horários. | Se os eventos de ciclovia/ciclista/checagem foram adicionados de propósito. |
| **A2 — Testes são o correto** (6 eventos) | Reduzir `ORLA_EVENT_DEFINITIONS` aos 6 eventos originais ou parametrizá-los por modo. | Se os 4 eventos extras ainda estão em desenvolvimento. |

**Recomendação:** A1, porque os eventos extras têm passos próprios (`701`, `801`–`803`) e textos em `ORLA_EVENT_STEPS`, o que indica trabalho concluído. A reescrita dos testes deve ser feita **derivando os valores de `ORLA_EVENTS`** em vez de números fixos, para o problema não se repetir.

**Solução (assumindo A1)**
1. Em `session.cjs`, substituir o array `[30_000, 85_000, ...]` por `ORLA_EVENTS.map(e => e.atMs)` e as contagens fixas (`6`, `325_000`) por valores calculados.
2. Em `orla-phase.cjs`, trocar os `jump(30_000)`, `jump(85_000)` etc. por `jump(eventAt('<id>'))` com um helper que leia `ORLA_EVENTS`.
3. Em `scenes.cjs`, ajustar as 4 expectativas (linhas ~627 e ~645) da mesma forma.
4. Corrigir o `TypeError` na origem: os testes chamam `problem(id).stage` sem verificar se existe. Adicionar um `assert.ok(problem(id), ...)` antes, para a falha apontar o evento ausente em vez de estourar `undefined`.
5. Verificar o impacto de `orderIntervalMs: 55_000` + `sequential: true` com 10 eventos de 60s cada: o modo sequencial pode empilhar pedidos e estourar `maxExpiredOrders: 3`.

**Critério de aceite:** `session.cjs`, `scenes.cjs` e `orla-phase.cjs` 100% verdes (26 + 15 + 5 testes).

---

## ETAPA 2 — Travessia: carros param com 1–2 pedestres (3 falhas)

### Problema B — `publishCrossing()` conta pedestres sem exigir o grupo de 3
**Arquivo afetado:** `crossings.cjs` (3 testes) · **Corresponde a:** CT-2.1 do plano (a hipótese 2.2 estava certa; ver nota abaixo)

**Evidência**
- [ActiveMobilitySystem.ts:380](src/game/traffic/ActiveMobilitySystem.ts#L380) conta `wait-road + form-road + cross-road` e publica qualquer valor `> 0` em `setPedestrianCrossingState`.
- [TrafficSystem.ts:619](src/game/traffic/TrafficSystem.ts#L619) e [:759](src/game/traffic/TrafficSystem.ts#L759) usam `waitingPedestrians > 0` para acionar `carsYield` e o ciclo amarelo → vermelho.
- O grupo só começa a travessia com `waiting.length >= CROSSING_RULES.roadGroupSize` (3) ou em modo `drain` ([ActiveMobilitySystem.ts:368](src/game/traffic/ActiveMobilitySystem.ts#L368)).
- Resultado: com 1 ou 2 pedestres, os carros param **e** os pedestres não atravessam → o deadlock descrito no plano.

**Sintomas observados**
| Teste | Erro |
|---|---|
| 1–2 pedestres não param ciclistas nem carros | `waitingPedestrians` = 2, esperado 0 |
| 1 pedestre na ciclovia | `waitingPedestrians` = 1, esperado 0 |
| Trio inicia junto, carros respeitam a faixa | condição falsa (`sawGroup && sawStoppedCar && released && resumed`); causa provável é a mesma, **não confirmada isoladamente** |

> **Nota sobre o plano:** a análise inicial suspeitava que o `drain` e a guarda `!unsafeCrossing` já tivessem resolvido o deadlock. Os testes mostram que **não resolveram**: o bug continua reproduzível.

**Solução**
1. Em `publishCrossing()`, publicar a contagem de espera apenas quando ela for efetiva:
   - `waiting >= roadGroupSize`, **ou**
   - existe `roadBatch` ativo, **ou**
   - `drainRoadQueue` / travessia assistida estão ligados.
   Caso contrário, publicar `0`. Isso mantém os carros livres com 1–2 pedestres.
2. Manter o contador bruto separado (ex.: `getCrossingProgress().waiting`) para o HUD do [OrlaTablet.tsx](src/components/game/OrlaTablet.tsx#L53), que mostra "pedestres esperando" — a UI deve continuar exibindo o número real.
3. Revisar [TrafficSystem.ts:599](src/game/traffic/TrafficSystem.ts#L599) (`isPedestrianCrossingClear`) para confirmar que continua consistente com o novo valor publicado.
4. Rodar `crossings.cjs` com `dt = 0.05` e `dt = 1/60` (os dois testes de fluxo contínuo de 180s já passam e não podem regredir).

**Critério de aceite:** `crossings.cjs` 5/5, incluindo o teste de trio.

---

## ETAPA 3 — Itens do plano sem teste automatizado (pendentes)

Os testes existentes **não cobrem** os itens abaixo. Eles precisam de novos testes antes ou junto da correção. Ordem sugerida:

| Ordem | Item | Teste a criar | Observação |
|---|---|---|---|
| 3.1 | **CT-2.2** Liberação pós-conflito | Carro já além do cone/faixa mantém velocidade quando a faixa fecha | [TrafficSystem.ts:764](src/game/traffic/TrafficSystem.ts#L764): `laneAvailable` zera `targetSpeed` de **todos** os carros da faixa |
| 3.2 | **CT-2.3** Yellow Box | Carro não para sobre a faixa se não houver espaço de `VEHICLE_LENGTH` à frente | Exige definir a constante e a métrica de "espaço livre" |
| 3.3 | **CT-3.1** Solidez de veículos parados | Jogador não atravessa carro parado/em recarga/acidentado | `getPlayerCollision()` ignora `speed ≤ 0.05` |
| 3.4 | **CT-3.2** NPCs × mobiliário | Pedestres desviam de bancos, lixeiras, postes | [ActiveMobilitySystem.ts:450-482](src/game/traffic/ActiveMobilitySystem.ts#L450) move em linha reta |
| 3.5 | **CT-4.1 / 4.2** Faixa elétrica | Teste geométrico: largura ≥ 1.20 m | [GridMapView.ts:1400](src/game/map/GridMapView.ts#L1400) usa `0.82` |
| 3.6 | **CT-5.x** Tutorial | Movimento livre e atalho de skip | Teste de componente React; hoje a suíte só cobre `.cjs` do núcleo |
| 3.7 | **CT-6.x** Acessibilidade e carga | `aria-live`, foco por teclado, métrica de memória na sessão de 6 min | Definir limites numéricos de aceite antes |

**Dependência:** a ordem 3.1 → 3.2 → 3.3 → 3.4 respeita que 3.1–3.2 compartilham `TrafficSystem.ts` e 3.3–3.4 compartilham `ActiveMobilitySystem.ts`. Os itens 3.5 e 3.6 são independentes e podem rodar em paralelo.

---

## 3. Resumo executivo

| Etapa | Causa | Testes destravados | Esforço estimado |
|---|---|---|---|
| 1 | Cronograma de 10 eventos × testes de 6 eventos | 11 | Baixo (ajuste de testes) + 1 decisão do time |
| 2 | `publishCrossing()` sem regra de grupo de 3 | 3 | Baixo (mudança localizada) |
| 3 | Cobertura inexistente para CT-2.2 a CT-6.2 | — | Médio/alto (7 itens novos) |

**Não executado nesta rodada:** correções de código, a sessão de 6 minutos com métricas de framerate/memória (CT-6.2) e qualquer teste de interface no navegador. Todos os números acima vêm de execução real dos testes existentes.

---

## 4. Correções aplicadas (Etapas 1 e 2)

Decisão do time: **os 10 eventos do código são a fonte da verdade** (opção A1). Resultado final: `npm test` com 95 testes, 95 aprovados.

### Etapa 2 — Travessia (código + testes)
| Arquivo | Mudança |
|---|---|
| [ActiveMobilitySystem.ts](src/game/traffic/ActiveMobilitySystem.ts) `publishCrossing()` | Só publica pedestres esperando ao tráfego quando a travessia vai acontecer: grupo de 3, lote em formação ou fila em esvaziamento (`drain`). Com 1–2 pedestres os carros seguem livres. O HUD continua usando o contador bruto de `getCrossingProgress()`. |
| [crossings.cjs](tests/crossings.cjs) (teste do trio) | A asserção "os 3 no mesmo Z" era de um desenho antigo. O grupo atravessa em **fila indiana** (0,72 de espaçamento em Z), e o primeiro a chegar sai de `cross-road` antes dos demais. O teste agora valida lote de 3, mesmo X e espaçamento. |

### Etapa 1 — Cronograma × testes
O diagnóstico original ("sincronizar horários") estava **incompleto**. Além dos horários, três coisas mudaram no jogo e os testes ainda descreviam o modelo antigo:

1. **Chamados em série.** `ORLA_SESSION_CONFIG` usa `sequential: true`. Só há um chamado ativo por vez, o resolvido espera `archiveCompleted` e o próximo sai em `max(horário, arquivamento)`. Os testes antigos esperavam 6 chamados simultâneos.
2. **Fim antecipado.** Concluir os 10 encerra a fase. Antes, a fase só terminava aos 6 minutos.
3. **Limite de expirações.** `maxExpiredOrders: 3` encerra a fase na terceira expiração, e não ao fim dos 6 minutos.

| Arquivo | Mudança |
|---|---|
| [session.cjs](tests/session.cjs) | 2 testes reescritos a partir de `ORLA_EVENTS`: liberação em série com arquivamento e fim ao concluir o 10º; expiração um a um até o limite, com pausa preservada. |
| [scenes.cjs](tests/scenes.cjs) | Seleção inicial `[2,2,3,1,2]` (`start()` já notifica a Mobilidade); treino usa `ORLA_EVENTS[0]`; "fase real" reescrito em torno do semáforo quebrado (Mobilidade protege a faixa antes de a Infra poder entrar); prazo usa `maxExpiredOrders`. O relógio é lido de `game.session`, porque o snapshot do store publica com atraso. |
| [orla-phase.cjs](tests/orla-phase.cjs) | Reescrito com os helpers `skipTo(id)` e `dispatch(id)`. **12 testes** cobrem os 10 eventos, mais duas rodadas contínuas (jogador automático que conclui tudo; rodada sem ações que expira até o limite). |

### Bug real encontrado e corrigido
**Serviço pausado nunca resolvia o chamado** — [OrlaPhase.ts](src/game/scenes/OrlaPhase.ts), `update()`.
Quando a Infra saía do ponto durante um serviço (sensor, carregador, colisão), o chamado voltava a `ACTIVE`. Ao retornar, o serviço continuava, mas o status não voltava a `MAINTENANCE`. `completePuzzle` ignora chamados fora de `MAINTENANCE`, então o quebra-cabeça concluído não resolvia nada e o chamado ficava preso até expirar. A correção restaura `MAINTENANCE` ao retomar o serviço. Antes, o teste antigo de sensor cobria esse caminho; a versão reescrita o mantém.

### Cobertura nova
Antes só poste, travessia, pico, sensor e colisão tinham teste de fase. Agora também têm: **checagem do semáforo, ciclovia bloqueada, cone na ciclovia, carregador elétrico (exige desvio com 4 antes do reparo) e resgate do entregador**.

### Observação sobre o plano original
O CT-2.1 foi confirmado como bug real (carros parando sem pedestres atravessando) e corrigido. Já o CT-2.2, CT-2.3 e os itens 3.x seguem **sem teste e sem correção**.

## 5. Etapa 3 — resultado por item

Cada item começou por um teste que falhava (ou, no caso do CT-6.2, que passou de primeira) e só depois recebeu a correção.

| Item | Situação | O que foi feito |
|---|---|---|
| **CT-2.2** Liberação pós-conflito | ✅ | [TrafficSystem.ts](src/game/traffic/TrafficSystem.ts): ao interditar, guarda-se o ponto do bloqueio (`blockAnchorX`, posição do jogador ou a faixa de pedestres). Quem já entrou na área de conflito ou passou dela segue até sair do mapa; quem ainda chega para. |
| **CT-2.3** Anti-bloqueio (yellow box) | ✅ | `keepClearRoom()`: se o carro da frente está parado logo depois da faixa e sobra menos que `VEHICLE_LENGTH` + folga, quem chega espera antes da faixa. Volta a andar quando abre espaço. |
| **CT-3.1** Veículos parados sólidos | ✅ | `resolveWorkerMovement(..., onlyStopped)` agora vale também para a Mobilidade ([Fase1OrlaScene.ts](src/game/scenes/Fase1OrlaScene.ts)). Antes só a Infraestrutura era barrada. Carros em movimento continuam atropelando e reiniciando o personagem. |
| **CT-3.2** NPCs × mobiliário | ✅ | `GridMap.obstacles` é preenchido pela view (coqueiros, guarda-sóis, torre, bancos, postes, lixeiras). `ActiveMobilitySystem.avoidFurniture()` desvia pedestres na aproximação e na dispersão. Perto do destino o desvio é desligado, para a fila de travessia continuar exata. Um teste confirma que todo item desenhado vira obstáculo. |
| **CT-4.1** Largura da faixa elétrica | ✅ | `0,82 m → 1,20 m`, com 32 cm de folga lateral por carro. A geometria agora vem de [roadLayout.ts](src/game/map/roadLayout.ts), usado por mapa, tráfego e travessia. As pistas de sentido leste foram 0,4 m para o sul (a folga do canteiro continua ≥ 1,0 m). Foram ajustados: linha de retenção, refúgio central, tracejados e carregador. |
| **CT-4.2** Pictogramas e contraste | 🟡 parcial | O pictograma foi ampliado (×1,3) para a nova largura. Contraste e legibilidade **não foram medidos** nem vistos em tela. |
| **CT-5.3** Pular o tutorial | ✅ | `Game.skipTutorial()` funciona em qualquer etapa e é idempotente. Botão "Pular tutorial" nos três guias, acessível por teclado. Também corrigi o texto final da Infraestrutura, que ainda descrevia o jogo antigo. |
| **CT-5.1 / CT-5.2** Tutorial sem bloqueio | ⏸️ não feito | É redesenho de UX (micro-cards, onboarding diegético), não correção. Ver pendências. |
| **CT-6.1** Acessibilidade | ⏸️ auditoria feita | `role="status"`/`aria-live` já existem em HUD, toasts, puzzles e guias. Sem ferramental de teste de componente, não há como automatizar. |
| **CT-6.2** Sessão contínua | ✅ | Simula ~340 s a 60 fps com 10 chamados: objetos limitados, posições finitas, sem crescimento da cena e custo médio por quadro < 16 ms. |

## 6. Pendências

- **Verificação visual da Etapa 4.** Mudei a geometria da avenida (faixas, linhas de retenção, refúgio, carregadores) e validei só por números e testes. **Vale abrir o jogo e olhar a Orla**, principalmente a faixa verde, os carregadores e a travessia. Eu não consegui ver o resultado.
- **CT-5.1 e CT-5.2:** o tutorial ainda trava a tela com máscara escura. Exige decisão de design antes de implementar; hoje só foi resolvido o atalho de pular.
- **CT-6.1:** precisa de uma ferramenta de teste de componentes (por exemplo Testing Library com jsdom) para checar `aria-live`, foco por teclado e uso de cor com símbolo nos alertas.
- **CT-6.2:** a simulação roda sem renderização. Memória da GPU e framerate real no navegador continuam sem medição.
- **Atalho de teclado para pular o tutorial:** o plano sugeria Esc/Espaço, mas Esc já pausa o jogo. Só o botão foi feito.
- **Não commitado:** todas as alterações estão na árvore de trabalho. `PLANO_DE_TESTES_E_ANALISE_UI_UX.md`, este relatório e `src/game/map/roadLayout.ts` ainda não são rastreados pelo git.

## 7. Verificação visual e combinações (rodada final de testes)

### Defeito encontrado na verificação visual
Uma captura da avenida em jogo mostrou o refúgio amarelo da travessia desalinhado dos vasos do canteiro central. A conferência numérica confirmou um erro meu da Etapa 4: ao deslocar as pistas de sentido leste (CT-4.1), a pista `orla-eastbound-2` ficou **23,7 cm dentro do canteiro**, e o refúgio da travessia foi movido sem mover o canteiro real.

**Correção:** [roadLayout.ts](src/game/map/roadLayout.ts) agora tem a posição do canteiro (`median: 3.41`) e o canteiro, o refúgio, as linhas de retenção e as pistas de sentido oeste leem dela. Folga simétrica de 11 cm entre cada pista e o canteiro. O teste novo "nenhuma pista invade o canteiro central…" cobre isso, e o teste antigo de largura da faixa verde só olhava a faixa verde, por isso não pegou.

### Combinações entre as regras novas (item 2)
| Teste | O que garante |
|---|---|
| CT-2.2 + CT-2.3 | Em 240 s, com bloqueios e liberações alternados nos dois sentidos, nenhum carro fica parado mais de 2,5 s sobre a faixa (a 20 e a 60 quadros/s). **Mutação:** desligando as duas regras, o teste falha. |
| CT-3.1 + acidente | Com um acidente e a fila de carros parados formada, nenhum ponto de partida válido consegue entrar em um carro parado. Carros em movimento continuam atropelando. |
| CT-3.2 + travessia | Com o mobiliário real da Orla (mais de 10 obstáculos), em 240 s pelo menos 2 grupos atravessam, 6 pedestres concluem a travessia e nenhum pedestre fica preso fora das filas de espera por mais de 12 s. |

## 8. Passagem de bastão: melhorias recomendadas

Nada abaixo foi implementado. Os testes automatizados estão terminados, e a lista abaixo é o que sobrou de decisão ou de melhoria.

**Do que apareceu na captura da Orla em jogo**
1. **Pedestres empilhados na travessia.** Durante o semáforo quebrado, cerca de dez pedestres ficam sobrepostos no mesmo ponto da calçada. A fila aceita todos na mesma posição de espera. Vale espaçar os pontos de espera e limitar o total na fila.
2. **Área vazia abaixo da avenida.** A câmera mostra cerca de metade da tela de areia ondulada sem nada, abaixo da avenida. Vale recortar o enquadramento ou aproveitar o espaço.
3. **Barra de controles cobre a avenida** na câmera padrão, quando o personagem está na calçada.
4. **Tablet da Analista reaparece sozinho** por cima da cena conforme o tempo de jogo, e a câmera fica presa ao personagem selecionado. Vale conferir se isso é intencional.

**Do plano original que ficou em aberto**
5. **CT-5.1 e CT-5.2:** tutorial sem máscara escura (micro-cards, onboarding por missão guiada). Exige decisão de design.
6. **CT-6.1:** acessibilidade. `aria-live` e `role="status"` já existem, mas faltam teste automatizado de componente (Testing Library com jsdom), foco por teclado nos botões novos e uso de cor com símbolo.
7. **CT-4.2:** contraste e legibilidade do pictograma do carro elétrico no chão. Nunca foi medido.
8. **Atalho de teclado para pular o tutorial:** Esc já pausa, então só existe o botão.

**Regras de jogo para confirmar com quem desenhou**
9. **`maxExpiredOrders: 3`:** com 10 chamados de 60 s em série, ignorar os três primeiros encerra a fase em cerca de 190 s, bem antes dos 6 minutos.
10. **Fim antecipado:** a fase termina ao concluir os 10 chamados, mesmo antes dos 6 minutos.

**Testes que ainda poderiam existir**
11. Rodadas contínuas com semente aleatória diferente, `dt` irregular (30 fps, quedas de quadro) e reinício no meio da sessão.
12. Alcançabilidade: nenhum obstáculo do `GridMapView` bloqueia o caminho de ponta a ponta de um pedestre.
13. Memória e framerate reais no navegador (a simulação atual não renderiza).

**Organização**
14. Commits separados: tráfego e travessia, bug do serviço pausado, regras CT-2.2 a CT-3.2, geometria da avenida, pular tutorial, testes e relatório.
15. Um script `check` que rode `npm test` e `tsc --noEmit` juntos (os testes removem os tipos).
16. Trocar ou anotar o `PLANO_DE_TESTES_E_ANALISE_UI_UX.md`, cujo diagnóstico está parcialmente superado.
