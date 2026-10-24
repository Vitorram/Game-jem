# Servidor cooperativo SUBURBAN

Backend Node.js (22/24) com HTTP e WebSocket via `ws`. Os estados das salas vivem em memória dentro de um único processo. O frontend Next.js não contém rotas de API nem banco de dados.

## Executar

Na raiz do projeto:

```sh
npm ci
npm run coop:server
```

Em outro terminal, `npm run dev`. Abra `http://localhost:3000/coop`.
O Node executado diretamente **não carrega .env automaticamente**. Exporte as variáveis no terminal ou use `node --env-file=.env.local backend/server.mjs` com um arquivo que exista. O Next carrega suas próprias variáveis .env.

Para testar entre computadores da mesma rede, inicie o frontend com `npm run dev -- --hostname 0.0.0.0` e acesse pelo IP do host. Sem `NEXT_PUBLIC_COOP_SERVER_URL`, o navegador HTTP usa o hostname da página na porta 3001. Uma configuração explícita com localhost só funciona na própria máquina; remova-a ou troque pelo IP do host. Libere as portas necessárias no firewall.

## Fluxo e regras

- Criar sala gera código de oito caracteres. Salas podem ser públicas ou acessíveis somente pelo código; apenas a anfitriã muda a visibilidade.
- A lista pública mostra apenas lobbies públicos com vagas. Atualizações são enviadas pelo servidor aos navegadores que solicitaram a lista.
- Cada sala tem até três papéis diferentes. Escolher um papel ocupado retorna erro; o servidor não troca a personagem silenciosamente. No lobby, `set-role` troca para um papel livre e cancela a prontidão de quem trocou.
- Só a anfitriã inicia, com 2 ou 3 pessoas prontas. **Trio**: Analista, Mobilidade e Infraestrutura. **Dupla**: obrigatoriamente Mobilidade + Infraestrutura (sem elas não há quem repare ou organize o trânsito); as duas recebem as permissões da Analista. Uma pessoa sozinha, ou uma dupla com a Analista, recebe TEAM_INCOMPLETE. O modo (`mode: 'trio' | 'duo'`, `sharedAnalyst`) acompanha a composição no lobby e é congelado no `start`.
- Cada conexão confirma seu próprio prólogo antes do tutorial. O relógio é liberado quando todas as pessoas que iniciaram a partida (2 ou 3) confirmam o tutorial.
- A autorização de `action` usa o papel principal mais as permissões do modo (`permissionsFor` em protocol.mjs). Em dupla: Mobilidade = `interact`, `mobility-hotkey` + central; Infraestrutura = `interact`, `repair-complete` + central; central = `analyze`, `dispatch`, `archive`, `call-tow`, `problem-select`. No trio, só a Analista usa a central.
- Ações da central são idempotentes por chamado (`analysisKey`): `analyze`/`archive`/`call-tow` por `problemId` e `dispatch` por `problemId` + equipe. A primeira cópia é retransmitida; as repetidas (duas pessoas confirmando ao mesmo tempo) recebem `ack` e não são retransmitidas, sem erro, porque o efeito já existe em cada cliente.
- A pausa pertence à sala. Qualquer participante pode pausar/retomar, preservando o comportamento anterior. Movimento transitório em trânsito durante a pausa é descartado; ações recebem erro.
- A saída de uma pessoa no lobby libera sua vaga e transfere a anfitriã. Após o início, encerra a sessão para as demais com uma mensagem explícita: não há snapshot completo que permita substituir a pessoa ou restaurar a partida com segurança.
- Recarregar a página exige entrar novamente. O cliente não apresenta os dados antigos de sessionStorage como uma conexão recuperada.
- Reiniciar o processo encerra todas as salas. Não há persistência.

## API HTTP

Respostas JSON com cache desabilitado; sem cabeçalhos CORS globais.

| Rota | Resultado |
| --- | --- |
| GET /health (HEAD também) | 200, saúde e contagem de salas, pessoas em sala e conexões |
| /health ou /coop com outro método | 405 e Allow |
| GET /coop sem upgrade | 426 |
| Rota inexistente | 404 |
| Upgrade WebSocket /coop | 101 quando handshake, origem e limites são válidos |

Os erros HTTP têm `{ error: { code, message } }`.
A saúde não exige login; não devolve nomes, códigos privados nem segredos.

## Protocolo WebSocket

Comandos JSON: `create-room`, `join`, `join-open`, `list-rooms`, `leave`, `set-role`, `ready`, `set-public`, `start`, `tutorial-open`, `tutorial-ready`, `pause`, `move`, `action`. A ação `dispatch` aceita `problemId` opcional; o cliente atual sempre o envia para que o despacho não dependa da seleção local.

Os comandos de controle enviados pelo cliente incluem `requestId`. O servidor responde `ack` ou `error` com o mesmo identificador, além dos eventos de estado. Os últimos 128 resultados de cada conexão são deduplicados; reutilizar um ID com outro conteúdo retorna REQUEST_CONFLICT. Não há retentativa automática de mutações após timeout. O cliente encerra a conexão se uma confirmação não chega em oito segundos, pois o resultado seria incerto.

Erros incluem `code` estável e `message` legível: INVALID_MESSAGE, INVALID_JSON, UNKNOWN_COMMAND, NOT_IN_ROOM, FORBIDDEN, ROOM_NOT_FOUND, ROOM_FULL, ROLE_TAKEN, ALREADY_JOINED, INVALID_PHASE, TEAM_INCOMPLETE, TEAM_NOT_READY, INTRO_REQUIRED, GAME_PAUSED, RATE_LIMITED, SERVER_FULL, REQUEST_CONFLICT, INTERNAL_ERROR.

Campos desconhecidos, coerções de booleanos, nomes vazios/longos, papéis inválidos, ações desconhecidas, coordenadas não finitas e eixos fora de intervalo são rejeitados antes de alterar estado. Erros inesperados são registrados no servidor e recebem mensagem pública sem detalhes internos.

## Identidade e permissões

O jogo usa participantes convidados, sem cadastro, senha, JWT ou cookies de autenticação. A conexão recebe UUID aleatório; o servidor vincula a ela sala e papel. Campos enviados pelo navegador não podem trocar essa identidade.

| Papel | Ações de jogo permitidas |
| --- | --- |
| Analista | interação, seleção/análise, acionamento de equipe, arquivo e guincho |
| Mobilidade | interação e habilidades Digit1–Digit4 |
| Infraestrutura | interação e conclusão de reparo |

Apenas integrantes podem agir numa sala; somente a anfitriã inicia/muda visibilidade. IDs públicos de jogadores não autenticam ninguém. O código privado é um convite, não uma conta autenticada.

## Transporte e limites

- `ws` valida handshake, máscara, UTF-8, fragmentação e controles do protocolo.
- Mensagens de texto limitadas a 16 KiB; binários recusados. Compressão desabilitada.
- Máximo de 512 KiB de saída pendente por conexão; consumidores lentos são desconectados.
- Limite total por conexão: 120 mensagens/s, com rajada de 240. Controle do lobby: 5/s, rajada de 30.
- Até 60 tentativas de conexão por minuto por IP. Contagem utiliza o IP do socket, sem confiar em X-Forwarded-For.
- Heartbeat a cada 30 s remove conexões sem pong. Conexões sem sala expiram após cinco minutos sem comandos.
- Atualizações da lista são agrupadas em janelas de 50 ms e enviadas somente aos interessados.

Configurações: COOP_HOST (0.0.0.0), COOP_PORT (3001), COOP_MAX_CONNECTIONS (256), COOP_MAX_CONNECTIONS_PER_IP (32), COOP_MAX_ROOMS (128), COOP_ALLOWED_ORIGINS (origens exatas separadas por vírgula).

## Produção

Use TLS e proxy que suporte WebSocket. Configure NEXT_PUBLIC_COOP_SERVER_URL com o endereço **público** wss; essa variável vai para o bundle e nunca deve conter segredos.

Com NODE_ENV=production, COOP_ALLOWED_ORIGINS é obrigatório e conexões sem Origin ou fora da lista são recusadas. Em desenvolvimento, sem lista explícita, origens HTTP(S) precisam ter o mesmo hostname do backend (a porta pode ser diferente); clientes sem Origin são permitidos. Origin é proteção de navegador, não autenticação de identidade.

Atrás de proxy, conexões podem compartilhar o mesmo IP de origem para os limites. Ajuste o limite e aplique rate limit por IP real no proxy; não habilite confiança irrestrita em cabeçalhos encaminhados.

## Validação

```sh
npm run test:coop
node --test --test-name-pattern="coop:" tests/scenes.cjs
npm test
npm run typecheck
npm run build
```

O repositório não possui script/configuração de lint. Os testes de coop usam portas locais efêmeras e encerram os próprios servidores; não precisam do servidor de desenvolvimento nem alteram salas reais.

## Limites que permanecem

O servidor é autoritativo sobre sala, identidade, autorização e progressão do início; não sobre a simulação Three.js. Física, ocorrências, progresso de puzzles e placar ainda são calculados nos navegadores. Validação de tipo/papel não prova que um reparo foi resolvido nem elimina divergências de relógio/física ou trapaça de clientes modificados. Uma simulação autoritativa exige outra etapa arquitetural, com snapshots e comandos de domínio compartilhados.

Não há contas, matchmaking entre processos, reconexão de partida, armazenamento persistente nem recuperação após reinício. Não distribua salas entre réplicas independentes sem coordenação de estado.
