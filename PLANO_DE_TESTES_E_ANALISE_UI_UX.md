# Planejamento de Testes, Diagnóstico Técnico e Reformulação UI/UX
**Projeto:** Projeto Zero / Game-jem (Next.js + Three.js + GSAP)  
**Documento:** Bateria de Testes Integrada, Diagnóstico de Engenharia & Proposta UI/UX  
**Data:** 23 de Outubro de 2026  

---

## 1. Sumário Executivo

Este documento consolida o diagnóstico técnico aprofundado, as recomendações de design de interação e acessibilidade, e o planejamento estruturado em 6 etapas para aprimoramento do jogo. O foco central é corrigir gargalos de tráfego, colisões e física, solucionar bugs em missões/chamados, modernizar o visual da via de veículos elétricos e flexibilizar a experiência inicial do jogador (tutorial).

---

## 2. Diagnóstico Técnico das Causas Raiz

A inspeção do código-fonte e dos testes automatizados revelou as origens dos comportamentos relatados:

### 2.1 Faixa de Carros Elétricos Estreita e Desproporcional
* **Arquivo:** `src/game/map/GridMapView.ts` (linhas 1397–1403)
* **Causa:** A faixa exclusiva da Avenida Verde está configurada com largura de apenas `0.82m` (`center.x, roadNorthZ + 0.46, size, 0.82`). Como os veículos possuem largura base de `0.56m`, a margem lateral é inferior a 13 cm de cada lado, gerando sensação de aperto e desalinhamento estético com as faixas automotivas convencionais. A textura e os pictogramas elétricos também carecem de detalhamento e segregação visual adequada.

### 2.2 Deadlock na Travessia (Carros Parados sem Pedestres Atravessando)
* **Arquivos:** `src/game/traffic/TrafficSystem.ts` (linhas 757–765) e `src/game/traffic/ActiveMobilitySystem.ts` (linhas 368–375)
* **Causa:** Em `TrafficSystem.ts`, a condição `carsYield` é acionada assim que `waitingPedestrians > 0`. No entanto, em `ActiveMobilitySystem.ts`, os pedestres só iniciam a travessia quando um grupo completo de 3 pessoas é formado (`roadGroupSize: 3`). Quando há apenas 1 ou 2 pedestres na calçada, os veículos param, mas os pedestres continuam aguardando o terceiro integrante indefinidamente.

### 2.3 Parada Indevida de Carros Pós-Cruzamento ou em Cima da Faixa
* **Arquivo:** `src/game/traffic/TrafficSystem.ts` (linhas 764 e 608–615)
* **Causa:** Ao interditar uma faixa (`lane.status === 'blocked'`), a variável `laneAvailable` torna-se `false` e zera imediatamente a velocidade-alvo (`targetSpeed = 0`) de **todos** os carros daquela faixa, inclusive aqueles que já ultrapassaram o ponto de conflito/cone. Além disso, não há validação de *Keep Clear* (não fechar o cruzamento): se a fila desacelera, carros que já entraram na área da faixa de pedestres acabam imobilizados em cima dela.

### 2.4 NPCs Atravessando Mobiliário Urbano (Clipping)
* **Arquivo:** `src/game/traffic/ActiveMobilitySystem.ts` (linhas 450–482)
* **Causa:** O deslocamento dos pedestres em direção à travessia e na dispersão (`exit`) é calculado por incremento linear direto (`walker.x += dir * speed * dt`) sem verificação de colisão espacial contra o `GridMap` ou contra as posições dos objetos decorativos (postes, lixeiras, quiosques, coqueiros, bancos).

### 2.5 Personagem Atravessando Veículos (Veículos Fantasmas)
* **Arquivos:** `src/game/traffic/TrafficSystem.ts` (linha 396) e `src/game/core/CharacterMotor.ts`
* **Causa:** A função `getPlayerCollision()` filtra apenas veículos com `vehicle.speed > 0.05` e tem como efeito apenas aplicar knockback e reinício de posição. Veículos estáticos (estacionados, carregando na via verde ou acidentados) não possuem colliders sólidos rígidos inseridos no motor de física/movimentação, permitindo transposição direta pelo jogador.

### 2.6 Divergência em Missões, Chamados e Testes Automatizados
* **Arquivos:** `src/game/session/orlaEvents.ts`, `src/game/scenes/OrlaPhase.ts`, `tests/`
* **Causa:** Alterações recentes no escalonamento e ordenação de eventos de `orlaEvents.ts` causaram quebras em testes de unidade e integração (`tests/crossings.cjs`, `tests/orla-phase.cjs`, `tests/scenes.cjs` e `tests/session.cjs`), gerando `TypeError: Cannot read properties of undefined` e falhas de sincronia de estado na máquina de missões.

---

## 3. Análise de UI/UX: Reformulação do Tutorial Inicial

### 3.1 Avaliação Heurística do Modelo Atual
O tutorial presente em `AnalystTutorialGuide.tsx`, `MobilityTutorialGuide.tsx` e `InfrastructureTutorialGuide.tsx` adota um padrão de *"railroading punitivo"*:
* **Perda de Agência:** Aplicação de máscaras escuras (*scrims*) que bloqueiam cliques em 95% da tela, travando os comandos de movimentação (WASD/Setas) e a exploração do cenário.
* **Sobrecarga Cognitiva Precoce:** Exigência de leitura e cliques forçados em painéis de interface antes mesmo do jogador assimilar o espaço do jogo e o propósito do seu personagem.
* **Aumento do Time-to-Fun:** Retarda o engajamento com as mecânicas reais de jogo.

### 3.2 Diretrizes de Solução UI/UX Propostas

1. **Tutorial Diegético e Contextual:**
   * Substituir o bloqueio de tela por micro-cards no canto superior da tela com objetivos claros (ex: *"Vá até o baú de cones com WASD"*).
   * O jogador mantém movimentação livre desde o início.
2. **Gatilhos de Proximidade (*Proximity Callouts*):**
   * A interface de ação só surge em destaque quando o jogador se aproxima do objeto relevante (ex: tecla `[E]` pulsando discretamente sobre o poste ou baú).
3. **Opção de Skip / Aceleração:**
   * Botão explícito `[Pular Tutorial]` ou atalho `[Esc / Espaço]` para jogadores recorrentes ou sessões de teste e desenvolvimento.
4. **Onboarding por Missão Guiada:**
   * Em vez de ensinar botões abstratos, criar uma ocorrência de treino reduzida e orgânica, onde cada ação surge como consequência direta de uma necessidade no cenário.

---

## 4. Planejamento da Bateria de Testes (6 Etapas Modulares)

```
[Etapa 1: Estabilização de Testes QA] 
       │
       ▼
[Etapa 2: Tráfego e Travessia de Pedestres]
       │
       ▼
[Etapa 3: Física e Colisão Espacial]
       │
       ▼
[Etapa 4: Design e Proporção da Faixa Elétrica]
       │
       ▼
[Etapa 5: Redesign UI/UX do Tutorial]
       │
       ▼
[Etapa 6: Acessibilidade e Teste de Carga da Sessão]
```

---

### ETAPA 1: Estabilização e Sincronização dos Testes Automatizados (QA Base)
* **Objetivo:** Estabelecer uma linha de base sólida com 100% dos testes unitários e de integração passando antes de iniciar refatorações profundas.
* **Itens a Executar:**
  * Sincronizar os testes `tests/orla-phase.cjs`, `tests/session.cjs` e `tests/scenes.cjs` com os horários e identificadores atuais de `src/game/session/orlaEvents.ts`.
  * Garantir integridade na emissão de eventos sem erros de propriedades indefinidas (`stage`, `status`).
  * Validar execução completa via `npm test`.

---

### ETAPA 2: Tráfego Inteligente e Sistema de Travessia
* **Objetivo:** Eliminar deadlocks entre carros e pedestres, e implementar regras de cruzamento limpo.
* **Casos de Teste:**
  * **CT-2.1 (Fluxo Contínuo com Poucos Pedestres):** Com 1 ou 2 pedestres na calçada aguardando, os carros não devem parar. A retenção só deve ocorrer com grupo formado (3 pedestres) ou intervenção assistida.
  * **CT-2.2 (Liberação Pós-Conflito):** Veículos que já cruzaram a linha X da faixa de pedestres ou do cone de interdição devem manter seu percurso até a saída do mapa.
  * **CT-2.3 (Regra Anti-Bloqueio / Yellow Box):** Implementar verificação de espaço após a faixa. Se o espaço for menor que `VEHICLE_LENGTH`, o carro deve esperar antes da faixa, nunca sobre ela.

---

### ETAPA 3: Física, Colisão e Navegação de Entidades
* **Objetivo:** Impedir transposição de malhas (clipping) entre personagens, veículos e mobílias urbanas.
* **Casos de Teste:**
  * **CT-3.1 (Solidez de Veículos Parados):** Integrar os veículos (em recarga, acidentados ou parados) como obstáculos cilíndricos/retangulares na verificação de deslocamento do `CharacterMotor.ts`.
  * **CT-3.2 (Navegação Segura de NPCs):** Adicionar verificação de obstáculos no avanço dos pedestres na orla/praia para desviar de bancos, lixeiras e postes.

---

### ETAPA 4: Redesenho Visual da Faixa Elétrica e Sinalização
* **Objetivo:** Readequar a escala, acabamento e identidade visual da Avenida Verde.
* **Casos de Teste:**
  * **CT-4.1 (Dimensionamento Geométrico):** Ampliar a largura de `0.82m` para ~`1.20m`–`1.30m`, oferecendo resguardo estético aos veículos elétricos.
  * **CT-4.2 (Sinalização e Pictogramas):** Ajustar materiais, demarcação zebrada/borda e escala dos pictogramas elétricos no chão para correta visualização e contraste na câmera do jogo.

---

### ETAPA 5: Redesign e Flexibilização UI/UX do Tutorial
* **Objetivo:** Garantir um onboarding não intrusivo e fluido.
* **Casos de Teste:**
  * **CT-5.1 (Liberdade de Movimentação):** O jogador deve conseguir mover o personagem com WASD/Setas a qualquer momento durante a fase introdutória.
  * **CT-5.2 (Micro-Cards Não-Bloqueantes):** Substituir as telas de travamento por painéis informativos flutuantes e orientados a ação.
  * **CT-5.3 (Mecanismo de Skip):** Validar atalho para pular o tutorial e iniciar a partida diretamente.

---

### ETAPA 6: Acessibilidade e Teste de Carga da Partida Completa
* **Objetivo:** Assegurar robustez operacional ao longo do tempo e conformidade com acessibilidade.
* **Casos de Teste:**
  * **CT-6.1 (Acessibilidade Sensorial e de Teclado):** Uso concomitante de cores e símbolos gráficos nos alertas de semáforo e emergência; foco navegável por teclado; anúncios via `aria-live`.
  * **CT-6.2 (Sessão Contínua de 6 Minutos):** Executar a partida completa da Orla com todos os eventos em série (semáforo, colisão, recarga, pico de fluxo e resgate) sem memory leaks, quedas de framerate ou congelamento de fila de missões.

---

*Documento salvo na raiz do projeto para fácil exportação e compartilhamento.*

