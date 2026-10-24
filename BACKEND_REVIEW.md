# Revisão do backend — 24/10/2026

## Escopo e ponto de partida

Análise realizada antes das alterações: estrutura do repositório, README principal, README do backend, package.json/lock, tsconfig, next.config, .env.example/.gitignore, servidor, cliente WebSocket, lobby, integração do GameCanvas/Game e testes existentes. Nenhum AGENTS.md foi encontrado no repositório ou nas pastas ancestrais consultadas.

O workspace já possuía alterações, inclusive arquivos staged. Elas foram preservadas. O trabalho não cria commits, deploys ou alterações em serviços externos.

Tecnologias encontradas:
- Next.js 16.4.2, React 19.3.1, TypeScript 7.0.2.
- Three.js 0.186.1 e GSAP 3.15.0 no navegador.
- Node.js para backend e node:test; execução validada com Node 24.11.0.
- Não há banco de dados, ORM, rotas API do Next, contas de usuário ou provedor externo de autenticação.
- Foi adicionada a dependência direta ws 8.22.0, fixada no lockfile.

## Fluxo anterior

As páginas /, /coop, /jogo e /teste-personagem eram renderizadas pelo Next. O lobby abria WebSocket /coop no servidor separado, criava ou entrava numa sala, escolhia um papel e aguardava três pessoas prontas. O servidor guardava Maps de salas/conexões, iniciava prólogo/tutorial e retransmitia movimentos e ações. O navegador guardava metadados da sessão em sessionStorage e calculava física, ocorrências e placar.

O único endpoint HTTP útil era /health; os demais caminhos/métodos recebiam resposta genérica 200. O protocolo WebSocket era implementado manualmente. Havia algumas verificações de anfitriã/fase, mas nenhuma autorização das ações por papel. Não existiam consultas SQL, operações em banco, tokens ou segredos de autenticação a corrigir.

## Problemas e correções

| Problema concreto | Correção |
| --- | --- |
| Parser manual aceitava frames sem máscara, não montava fragmentos corretamente e tinha proteção incompleta de tamanho | Transporte ws, máscara/UTF-8/fragmentos corretos, máximo de 16 KiB, binários recusados, compressão desativada |
| Sem limites de conexão, frequência, consumidor lento ou heartbeat | Limites globais/por IP, orçamento separado para controle, buffer de saída limitado, ping/pong e expiração de conexões sem sala |
| Site externo podia abrir sockets sem verificação de origem | Allowlist exata configurável; obrigatória em produção; validação restrita de hostname no desenvolvimento |
| Nomes/booleanos/papéis eram convertidos silenciosamente; objetos arbitrários podiam ser retransmitidos | Validação antes da mutação, campos desconhecidos recusados, enumerações e números limitados |
| Jogadora podia enviar ações de outro papel | Permissões vinculadas ao papel/UUID guardados na conexão; IDs/papéis não são aceitos como identidade enviada pelo cliente |
| Papel ocupado era substituído sem informar | ROLE_TAKEN explícito; lista pública mostra papel ocupado e exige outra seleção |
| Operações repetidas podiam reaplicar mutações | Identificadores de pedido e deduplicação dos últimos 128 resultados por conexão; conflito de conteúdo rejeitado |
| Primeiro prólogo concluído liberava a fase global sem rastrear os demais | Estado individual de prólogo/tutorial; exige três membros e três confirmações válidas |
| Desconexão durante jogo podia reabrir sala com simulação parcial | Session-ended para as demais pessoas; sala removida. No lobby, vaga/host são atualizados normalmente |
| Pausa era apenas um broadcast sem estado | Estado de pausa na sala e bloqueio de ações durante pausa/contagem inicial |
| HTTP retornava 200 em caminhos/métodos incorretos | 404, 405/Allow e 426; erros JSON consistentes; saúde separa jogadores e conexões |
| connect() resolvia durante CONNECTING, pedidos eram enfileirados sem limite e erros de payload eram ignorados | Promise única de handshake, timeout, pedidos confirmados por ack/error, invalidação explícita em falhas, sem replay offline |
| Socket antigo podia interferir na reconexão | Handlers ignoram sockets substituídos; desconexão rejeita pedidos e limpa identidade |
| SessionStorage era tratado como sessão recuperada sem vínculo vivo | Verifica sala/pessoa no cliente conectado; usa dados recebidos do servidor e exige reentrada após reload |
| Falhas da lista pareciam lista vazia; botões não mostravam operação pendente | Estados visuais de conexão, carregamento, erro, vazio e confirmação; retry explícito; comandos bloqueados enquanto pendentes |
| Puzzle de reparo remoto abria nas telas das outras personagens | Somente Infraestrutura recebe o puzzle local; demais clientes aplicam a conclusão uma vez e preservam seus controles |
| Timers podiam iniciar tutorial/navegação após saída | Cancelamento de timers, pausa local na queda e ação de retorno às salas |

As mudanças de comportamento foram justificadas pela regra já existente de três pessoas com papéis distintos e pela ausência de snapshot recuperável. Não foi criado um sistema novo de contas ou persistência.

## Arquivos alterados nesta revisão

- backend/server.mjs — transporte, ciclo de vida, HTTP, limites, autorização e fábrica isolada para testes.
- backend/protocol.mjs (novo) — validação dos comandos e matriz de permissões.
- src/game/coop/CoopClient.ts — handshake, pedidos/erros, validação de respostas, sessão e ciclo de conexão.
- src/components/coop/CoopLobby.tsx e CoopLobby.module.css — estados de interface e fluxo com confirmação do servidor.
- src/components/game/GameCanvas.tsx — sessão viva, falhas, pausa, timers e prontidão assíncrona.
- src/game/core/Game.ts — proteção do treino coop e reparo remoto.
- tests/coop-server.cjs e tests/coop-client.cjs (novos) — integração real, transporte, negócio e regressões do cliente.
- tests/scenes.cjs — regressão do puzzle remoto, usando o harness já existente.
- package.json e package-lock.json — ws e comando test:coop.
- .env.example, README.md e backend/README.md — execução, produção, protocolo e limites.
- BACKEND_REVIEW.md (este arquivo) — diagnóstico e resultados.

O arquivo next-env.d.ts foi regenerado pelo build e teve somente seus caminhos gerados restaurados ao estado anterior; não há mudança intencional nele.

## Validação executada

Antes de editar:
- npm run typecheck: aprovado.
- npm test: 125 testes; 122 aprovados e 3 falhas preexistentes.

Após as correções:
- npm install ws --save-exact: dependência instalada; auditoria do npm informou zero vulnerabilidades.
- node --check backend/server.mjs e node --check backend/protocol.mjs: aprovados.
- npm run test:coop: 19 testes aprovados.
- node --test --test-name-pattern="coop:" tests/scenes.cjs: 1 teste aprovado.
- npm test: 145 testes; 142 aprovados e as mesmas 3 falhas preexistentes.
- npm run typecheck: aprovado.
- npm run build: aprovado; /, /coop, /jogo e /teste-personagem geradas.
- Lint: não existe script nem configuração de lint no projeto; não foi declarado como executado.
- git diff --check: realizado; linhas finais extras introduzidas foram normalizadas.

Falhas preexistentes confirmadas tanto antes quanto depois:
1. tests/components.cjs:127 — StoryIntro: teste espera classe cinema, mas o prólogo renderizado usa outra estrutura.
2. tests/orla-phase.cjs:269 — ciclovia bloqueada: evento procurado não existe no catálogo atual e a leitura de atMs falha.
3. tests/scenes.cjs:717 — reenquadramento/seleção da Orla: valor observado 1, esperado 0 na linha 734.

Essas falhas impedem declarar a suíte completa verde. Não foram alteradas expectativas de testes nem regras do jogo apenas para fazê-las passar.

Os testes novos executam servidores reais em portas efêmeras e também usam sockets simulados para reproduzir timing de conexão/timeout. O teste de integração do motor usa o renderer simulado já adotado no projeto. Não foi feita validação visual interativa em navegador, teste de carga distribuída ou medição em dispositivos físicos.

## Riscos e pendências

- A simulação continua no navegador. O servidor valida identidade, papel, estrutura e fase, mas não prova resultado de puzzle, colisões ou placar. Relógios e simulações ainda podem divergir; snapshots/comandos autoritativos exigem trabalho arquitetural próprio.
- Sem banco/persistência: reinícios perdem salas. Sem contas: nomes são apelidos e códigos privados são convites, não autenticação de pessoa.
- Não há retomada da partida após queda/reload nem coordenação de salas entre múltiplas réplicas.
- Uma ação rejeitada durante uma corrida com pausa pode indicar estado local já divergente; o cliente encerra a conexão de jogo e oferece reentrada, em vez de esconder a falha.
- Em produção, configurar TLS, proxy WebSocket e COOP_ALLOWED_ORIGINS. Limites por IP usam o socket; em proxy/NAT devem ser ajustados junto ao rate limit do proxy.
- Frontend e backend devem ser atualizados juntos. Reinicie o processo coop para carregar o novo protocolo.
- Corrigir separadamente as três falhas preexistentes e adicionar uma configuração de lint se a equipe quiser esse gate.
- Permanecem os avisos preexistentes sobre require('three') e stripTypeScriptTypes nos testes.

Referência do transporte: [documentação oficial de ws](https://github.com/websockets/ws), usada para configuração de servidor, limite de mensagens, ping/pong e integração com HTTP.
