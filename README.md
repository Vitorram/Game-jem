SUBURBAN — Cidade Segura
Jogo de navegador cooperativo de estratégia, mobilidade urbana e resolução de ocorrências.

O SUBURBAN propõe tornar a circulação pela cidade mais segura e acessível. Na fase Orla, inspirada na orla central de Caraguatatuba (SP), os jogadores precisam identificar problemas urbanos, coordenar equipes e executar intervenções sem comprometer a mobilidade.
Código-fonte e entrega
- Repositório GitHub: https://github.com/Vitorram/Game-jem
- Código-fonte: disponível neste repositório, incluindo frontend, lógica do jogo e servidor cooperativo.
- Recursos visuais e sonoros: ver Assets e créditos.
- Instruções de execução: disponíveis abaixo.
Para a entrega, compartilhe o link do repositório ou envie uma cópia da pasta do projeto. Não é necessário incluir node_modules/ ou .next/; as dependências são instaladas pelos comandos abaixo.

Tecnologias
- Next.js (App Router) e React
- TypeScript
- Three.js para a cena 3D
- GSAP para animações
- Node.js para o servidor cooperativo
Requisitos
- Node.js 22 ou 24
- npm
- Navegador moderno (Chrome, Edge ou Firefox)
- Git (opcional, para clonar)
Como executar localmente
1. Obter o projeto
git clone https://github.com/Vitorram/Game-jem.git
cd Game-jem
Se recebeu a pasta compactada, extraia e abra um terminal dentro da pasta que contém o arquivo package.json.
2. Instalar as dependências
npm ci
3. Iniciar o jogo (terminal 1)
npm run dev
Abra http://localhost:3000 no navegador. Acesse /jogo para a experiência principal.
4. Iniciar o servidor cooperativo (terminal 2)
Mantenha o primeiro terminal aberto. Abra outro terminal na mesma pasta do projeto e execute:
npm run coop:server
A saída esperada é semelhante a:
SUBURBAN coop server listening on http://0.0.0.0:3001
Isso significa que o servidor cooperativo está ativo na porta 3001. 0.0.0.0 é o endereço de escuta do servidor, não um endereço para abrir no navegador. Acesse http://localhost:3000/coop para entrar no modo cooperativo.

O frontend e o servidor cooperativo são processos separados: para testar o modo online localmente, ambos precisam estar rodando. Para configuração de rede, salas e variáveis de ambiente, consulte [`backend/README.md`](backend/README.md).
Atenção para publicação: hospedar o frontend na Vercel não significa que o servidor cooperativo em backend/server.mjs estará funcionando automaticamente. O servidor Node.js precisa de hospedagem própria e configuração de conexão adequada para uso online fora do computador local.

Como jogar
O jogo distribui as tarefas entre três funções:
Equipe	Responsabilidade
Analista	Identificar ocorrências no mapa, consultar o tablet e encaminhar chamados.
Mobilidade	Organizar a circulação, sinalizar trechos, posicionar cones e administrar desvios.
Infraestrutura	Reparar instalações, iluminação e sensores.


Na Fase 1 — Orla, o jogador passa por um tutorial das funções antes do desafio com ocorrências e tempo limitado. As intervenções dependem da cooperação entre as equipes.
Controles principais
Tecla	Ação
W, A, S, D ou setas	Movimentar
Shift	Correr
E	Interagir / executar ação próxima
T	Trocar de equipe no modo solo
Q	Abrir ou guardar o tablet da Analista
Esc	Pausar ou retomar


Algumas ações da Mobilidade utilizam as teclas 1, 2, 3 e 4, conforme as instruções exibidas no jogo. Há também controles de toque para dispositivos compatíveis.
Organização do projeto
Pasta / arquivo	Conteúdo
src/app/	Páginas, rotas e estilos da aplicação Next.js.
src/components/game/	Interface do jogo, canvas, HUD e tablet.
src/game/core/	Motor do jogo, estado, câmera e entrada.
src/game/scenes/	Cenas e integração do cenário.
src/game/map/	Mapa da Orla e configurações espaciais.
src/game/traffic/	Trânsito, pedestres, ciclistas e travessias.
src/game/session/	Regras de partida, eventos, pontuação e tempo.
src/game/items/	Itens e interações.
backend/	Servidor do modo cooperativo e documentação própria.
public/	Arquivos estáticos e assets usados pelo frontend.
tests/	Testes automatizados do projeto.


Assets e créditos
Os recursos visuais e sonoros necessários ao jogo devem acompanhar o código-fonte, normalmente dentro de public/ ou de seus diretórios correspondentes. Parte dos personagens e elementos da cena é gerada proceduralmente por código com Three.js.

Antes da entrega final, confira todos os arquivos de imagem, áudio, textura, fonte e modelo 3D utilizados. Para cada asset de terceiros, informe autor, origem/link e licença ou permissão de uso. Não atribua autoria própria a materiais de terceiros. Se um asset foi criado pela equipe, registre essa informação.

Modelo para preenchimento dos créditos:
Asset	Autor / origem	Licença ou autorização
Modelos e elementos procedurais criados no código	Equipe do projeto (confirmar autoria)	Autoral, se aplicável
Imagens, texturas e interfaces adicionadas ao projeto	Preencher conforme os arquivos utilizados	Preencher
Músicas e efeitos sonoros	Preencher conforme os arquivos utilizados	Preencher
Fontes e modelos externos, se houver	Preencher conforme os arquivos utilizados	Preencher


A presença de nomes ou marcas no cenário não implica afiliação oficial com essas organizações.
Testes e compilação
Para conferir a tipagem e a compilação:
npx tsc --noEmit
npm run build
Para executar os testes automatizados configurados no projeto:
npm test
Para executar a versão compilada do frontend, após um build bem-sucedido:
npm start
O servidor cooperativo continua exigindo o processo separado npm run coop:server.
Estado de validação: este README documenta os comandos e a estrutura descritos no material do projeto. Ele não comprova que o build ou os testes passaram na versão atual do repositório; valide os comandos antes da entrega.

Publicação
O frontend Next.js pode ser publicado na Vercel conectando o repositório GitHub e usando o comando de build npm run build. Para disponibilizar o modo cooperativo publicamente, é necessário publicar também o backend em um serviço compatível com o servidor Node.js e configurar os endereços e variáveis indicados em [`backend/README.md`](backend/README.md).
Referências técnicas
- Next.js
- Three.js
- GSAP
SUBURBAN — Cidade Segura · Projeto de jogo educativo sobre segurança, cooperação e mobilidade urbana.