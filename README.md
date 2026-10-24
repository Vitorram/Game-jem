
---

## 📌 Sobre o projeto

| Informação | Descrição |
|---|---|
| **Nome** | SUBURBAN — Cidade Segura |
| **Gênero** | Estratégia, cooperação e investigação |
| **Plataforma** | Navegador Web |
| **Modo de jogo** | Solo e cooperativo online |
| **Jogadores no cooperativo** | 2 a 3 jogadores |
| **Cenário principal** | Orla de Caraguatatuba — SP |
| **Objetivo** | Melhorar a segurança e a mobilidade urbana |

### 🎯 Objetivos do jogo

- Identificar ocorrências e riscos na cidade.
- Melhorar a infraestrutura e a iluminação pública.
- Organizar o trânsito e as rotas de mobilidade.
- Coordenar equipes para resolver problemas.
- Garantir trajetos mais seguros e acessíveis.
- Incentivar a comunicação e a tomada de decisões em equipe.

---

## 🛠️ Tecnologias utilizadas

O projeto utiliza tecnologias modernas para desenvolvimento de aplicações web e jogos tridimensionais.

| Tecnologia | Utilização |
|---|---|
| **Next.js (App Router)** | Estrutura da aplicação web |
| **React** | Componentes e interfaces |
| **TypeScript** | Desenvolvimento e tipagem |
| **Three.js** | Renderização do cenário 3D |
| **GSAP** | Animações e transições |
| **Node.js** | Servidor cooperativo |
| **WebSocket (ws)** | Comunicação em tempo real |

---

## 🚀 Como executar o projeto

### Pré-requisitos

Antes de começar, tenha instalado:

- Node.js 22 ou 24
- npm
- Navegador atualizado (Chrome, Edge ou Firefox)
- Git (opcional)

### 1. Clonar o repositório

```bash
git clone https://github.com/Vitorram/Game-jem.git
cd Game-jem
```

Caso tenha recebido uma pasta compactada, extraia os arquivos e abra o terminal na pasta que contém o `package.json`.

### 2. Instalar as dependências

```bash
npm ci
```

### 3. Iniciar o frontend

No primeiro terminal, execute:

```bash
npm run dev
```

Acesse:

**http://localhost:3000**

Para abrir a experiência principal, utilize:

**http://localhost:3000/jogo**

### 4. Iniciar o servidor cooperativo

Mantenha o primeiro terminal aberto e, em um segundo terminal, execute:

```bash
npm run coop:server
```

O servidor cooperativo utiliza a porta `3001` por padrão no ambiente local.

Para acessar o modo cooperativo, abra:

**http://localhost:3000/coop**

> **Importante:** o frontend e o servidor cooperativo são processos separados. Para utilizar o multiplayer localmente, ambos precisam estar funcionando.

Para informações adicionais sobre configuração, salas e variáveis de ambiente, consulte [`backend/README.md`](backend/README.md).

---

## 🎮 Como jogar

O SUBURBAN distribui as responsabilidades entre três equipes, que precisam colaborar para resolver as ocorrências urbanas.

### 🔎 Analista

**Responsável pela investigação e coordenação.**

- Identificar problemas no mapa.
- Consultar informações no tablet.
- Analisar ocorrências.
- Encaminhar chamados.
- Acompanhar as intervenções das equipes.

### 🚦 Mobilidade

**Responsável pela circulação e organização do trânsito.**

- Administrar desvios.
- Sinalizar áreas de risco.
- Posicionar cones.
- Organizar a circulação de veículos.
- Contribuir para a segurança dos trajetos.

### 💡 Infraestrutura

**Responsável pela manutenção dos equipamentos urbanos.**

- Reparar instalações.
- Resolver problemas de iluminação.
- Realizar manutenção de sensores.
- Executar intervenções de infraestrutura.

### 👥 Modo cooperativo

O multiplayer permite partidas com **2 ou 3 jogadores**.

**Com 3 jogadores:** cada pessoa assume uma função específica: Analista, Mobilidade ou Infraestrutura.

**Com 2 jogadores:** os participantes assumem Mobilidade e Infraestrutura, compartilhando também as funcionalidades da Analista.

Nesse modo, ambos podem abrir individualmente o tablet da Analista com a tecla `Q`. As análises e ações realizadas são compartilhadas entre os jogadores.

A comunicação e a cooperação são essenciais para completar as missões.

---

## 🗺️ Fase 1 — Orla

A primeira fase acontece em um cenário inspirado na orla central de Caraguatatuba, no litoral norte de São Paulo.

O ambiente apresenta sistemas de circulação urbana e diferentes situações que exigem planejamento e tomada de decisão.

### Dinâmica da fase

1. Os jogadores recebem a missão.
2. Conhecem as funções por meio do tutorial.
3. Investigam os problemas apresentados.
4. Definem as intervenções necessárias.
5. Executam ações de mobilidade e infraestrutura.
6. Acompanham os resultados e o tempo disponível.

O desafio consiste em resolver as ocorrências sem prejudicar o funcionamento da cidade.

---

## ⌨️ Controles

| Tecla | Função |
|---|---|
| `W`, `A`, `S`, `D` | Movimentar personagem |
| `↑`, `↓`, `←`, `→` | Movimentação alternativa |
| `Shift` | Correr |
| `E` | Interagir ou executar ação próxima |
| `T` | Trocar de equipe no modo solo |
| `Q` | Abrir ou fechar o tablet da Analista |
| `Esc` | Pausar ou retomar |
| `1`, `2`, `3`, `4` | Ações específicas da Mobilidade |

O jogo também possui controles de toque para dispositivos compatíveis.

---

## 📁 Estrutura do projeto

```text
Game-jem/
│
├── backend/
│   ├── server.mjs
│   ├── protocol.mjs
│   └── README.md
│
├── public/
│   └── Assets estáticos do jogo
│
├── src/
│   ├── app/
│   │   └── Páginas, rotas e estilos
│   │
│   ├── components/
│   │   └── game/
│   │       └── Interfaces, HUD e tablet
│   │
│   └── game/
│       ├── core/
│       ├── scenes/
│       ├── map/
│       ├── traffic/
│       ├── session/
│       └── items/
│
├── tests/
│   └── Testes automatizados
│
└── package.json
```

### Principais diretórios

| Diretório | Responsabilidade |
|---|---|
| `src/app/` | Rotas e páginas Next.js |
| `src/components/game/` | Interface, HUD, canvas e tablet |
| `src/game/core/` | Motor do jogo, câmera e controles |
| `src/game/scenes/` | Cenas e integração do cenário |
| `src/game/map/` | Configuração espacial da Orla |
| `src/game/traffic/` | Veículos, pedestres, ciclistas e travessias |
| `src/game/session/` | Regras, eventos, pontuação e tempo |
| `src/game/items/` | Objetos e interações |
| `backend/` | Servidor e protocolo multiplayer |
| `public/` | Imagens, sons, modelos e outros assets |
| `tests/` | Testes automatizados |

---

## 🌐 Multiplayer e hospedagem

O SUBURBAN utiliza uma arquitetura com frontend e backend independentes.

### Frontend — Vercel

Responsável por disponibilizar a aplicação Next.js e a interface do jogo.

**https://suburban-tng.vercel.app**

### Backend — Render

Responsável por gerenciar as conexões WebSocket, salas e comunicação entre jogadores.

**https://game-jem.onrender.com**

Endpoint de verificação:

`https://game-jem.onrender.com/health`

Endpoint WebSocket:

`wss://game-jem.onrender.com/coop`

### Configuração de ambiente

No frontend publicado na Vercel, configure a variável utilizada pelo cliente multiplayer:

```env
NEXT_PUBLIC_COOP_SERVER_URL=wss://game-jem.onrender.com/coop
```

No Render, configure as origens permitidas:

```env
COOP_ALLOWED_ORIGINS=https://suburban-tng.vercel.app
```

O servidor deve escutar na interface `0.0.0.0` e na porta configurada pela hospedagem.

> **Atenção:** hospedar o frontend na Vercel não inicia automaticamente o servidor cooperativo. O backend precisa permanecer hospedado separadamente.

---

## 🧪 Testes e compilação

### Verificação de TypeScript

```bash
npx tsc --noEmit
```

### Compilação de produção

```bash
npm run build
```

### Testes automatizados

```bash
npm test
```

### Executar o frontend compilado

```bash
npm start
```

Para executar o backend separadamente:

```bash
npm run coop:server
```

**Observação:** os comandos estão documentados para facilitar a validação do projeto. A execução bem-sucedida dos testes e do build deve ser confirmada na versão atual do repositório.

---

## 🎨 Assets e créditos

O projeto utiliza recursos visuais e sonoros para compor a experiência do jogo.

Parte dos personagens e elementos do cenário pode ser gerada proceduralmente com Three.js.

Os demais arquivos ficam organizados nos diretórios correspondentes, normalmente dentro de `public/`.

### Registro de autoria

| Recurso | Autoria / origem | Licença |
|---|---|---|
| Elementos procedurais | Equipe do projeto (confirmar) | Autoral, se aplicável |
| Imagens e texturas | Identificar por arquivo | Verificar |
| Músicas e efeitos | Identificar por arquivo | Verificar |
| Fontes e modelos externos | Identificar por arquivo | Verificar |

Antes da entrega final, todos os assets de terceiros devem ter suas respectivas origens e permissões verificadas.

A presença de marcas ou nomes de organizações no cenário não representa necessariamente uma parceria ou afiliação oficial.

---

## 📦 Código-fonte e entrega

O código-fonte do SUBURBAN está disponível no GitHub:

### 🔗 [Acessar repositório SUBURBAN](https://github.com/Vitorram/Game-jem)

O repositório contém o frontend, os sistemas do jogo, o backend cooperativo e as instruções de execução.

Para compartilhar o projeto, utilize o link acima ou disponibilize uma cópia da pasta.

Não é necessário incluir os diretórios `node_modules/` e `.next/`, pois são gerados durante a instalação e compilação.

---

## 📚 Referências técnicas

- [Next.js](https://nextjs.org/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Three.js](https://threejs.org/)
- [GSAP](https://gsap.com/)
- [Node.js](https://nodejs.org/)

---

**SUBURBAN — Cidade Segura**

*Tecnologia, cooperação e mobilidade urbana para construir cidades mais seguras.*
