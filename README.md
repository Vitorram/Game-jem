# Projeto Zero — base para jogo de navegador

Next.js App Router + TypeScript + Three.js direto + GSAP. Cena de teste com jogador provisório, teclado/toque, pausa e entrada de câmera. A câmera elevada é apenas uma demonstração, não define o gênero do jogo.

## Rodar

Use Node.js 22 ou 24. Na pasta do projeto:

```bash
npm ci
npm run dev
```

Abra http://localhost:3000. Clique em **Entrar no cenário**. Mova com WASD, setas ou os botões de direção. Esc pausa/retoma. Ao sair da janela, o jogo pausa e aguarda sua confirmação para continuar.

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
| `public/assets/audio/` | Efeitos sonoros e músicas |
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
