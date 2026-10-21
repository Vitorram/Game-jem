# Projeto Zero — base para jogo de navegador

Next.js App Router + TypeScript + Three.js direto + GSAP. Cena de teste com jogador provisório, teclado/toque, pausa e entrada de câmera. A câmera elevada é apenas uma demonstração, não define o gênero do jogo.

## Rodar

Use Node.js 22 ou 24. Na pasta do projeto:

```bash
npm ci
npm run dev
```

Abra http://localhost:3000. Clique em **Entrar no cenário**. Mova com WASD, setas ou os botões de direção. Esc pausa/retoma. Ao sair da janela, o jogo pausa e aguarda sua confirmação para continuar.

## Personagens jogáveis

### Teste livre de habilidades

Na plataforma vazia de `/jogo`, cada personagem tem um painel próprio. **Infraestrutura:** WASD move; escolha Sensor ou Iluminação e pressione **E** (ou o botão do painel). Há cinco sensores de teste; a luz alterna suave, forte e desligada. **Mobilidade:** WASD move; **Enter** abre a edição, A/B/C escolhem o ponto a mover e um clique no mapa reposiciona esse ponto; Enter aplica a rota. Trocar de personagem descarta uma edição ainda não aplicada. **Análise:** use o mouse no mapa abstrato para inspecionar os três problemas simulados e marque riscos com o botão direito ou os botões do painel. Nesta tela, WASD não move a personagem.

As marcações e equipamentos permanecem ao trocar de personagem. **Reiniciar teste das três** limpa a demonstração. Não há missão, cenário urbano ou persistência após recarregar a página. `npm test` verifica também as regras das habilidades.

Em `/jogo`, escolha uma das três personagens nos botões à esquerda. Use **Ver de perto** para acompanhar os detalhes; **Visão ampla** afasta a câmera. WASD, setas e os controles de toque movimentam a personagem selecionada.

Os modelos procedurais em `Player.ts` têm ombros, cotovelos, quadris, joelhos e tornozelos articulados. A caminhada posiciona os pés com cinemática inversa de duas articulações. Respiração, piscadas, mochilas e cabelos continuam animados em repouso; cachos, mechas longas e cabelo azul têm movimentos próprios. Pausar o jogo congela as animações. Os modelos são construídos em Three.js, sem arquivos GLB externos.

Valide movimento, contato dos pés, seleção e liberação de recursos com `npm run test:characters` (Node 22.13+ ou 24).

## Itens na Fase 1 · Orla

Abra **Fase 1 · Orla** em `/jogo`. WASD/setas ou o direcional de toque movem a personagem. **E** ou **Ação · E** interage com a célula adjacente na última direção de movimento (eixo dominante nas diagonais). **Tab** troca a personagem quando o foco está no jogo; os botões de seleção continuam disponíveis. Tab em controles focados mantém a navegação normal da interface.

Há três caixas infinitas na linha de bancadas: Sensor (azul), Placa (amarela) e Barreira (laranja). Cada personagem carrega uma caixa acima da cabeça. Mãos vazias pegam da caixa ou de uma bancada ocupada; mãos ocupadas depositam em uma bancada vazia. Ações incompatíveis não alteram nada. Trocar de personagem preserva os três inventários; sair da fase descarta a sessão. Não há pedidos nem pontuação.

O catálogo fica em `src/game/items/itemData.ts`; as regras e direções em `ItemInteractions.ts`, sem Three.js. `orlaMap.ts` define as caixas e seus tipos; `ItemVisuals.ts` mantém os meshes e libera seus recursos no descarte da cena. Altura e tamanho dos itens ficam em `ITEM_VIEW_CONFIG`.

## Fluxo cooperativo de riscos na Orla

Há três pontos na faixa inferior do mapa: **1 · iluminação**, **2 · sensor**, **3 · rota/calçada interditada**. Um, dois ou três traços identificam os pontos no chão. A cor muda de azul (não inspecionado) para amarelo (inspecionado), vermelho (tarefa liberada), roxo (desvio em preparação) e verde (resolvido). O painel mostra o estado também em texto e pode ser recolhido.

1. Selecione **Análise**, caminhe até a célula vizinha e olhe para o ponto. **E** ou **Ação · E** inspeciona; outra ação marca o risco e libera a tarefa.
2. Troque com **Tab** ou os três botões de personagem. Posição, direção, itens e intervenções concluídas permanecem com suas donas. Na Orla, Análise também pode caminhar.
3. **Infraestrutura** usa E no ponto marcado para instalar o sensor ou acender a iluminação. **Mobilidade** usa E no ponto de rota para preparar um desvio de teste predefinido, e E novamente para confirmar. A rota original permanece até a confirmação; trocar para outra personagem cancela só o rascunho.

O papel errado ou uma tarefa ainda não liberada não produz intervenção. Ações repetidas em um risco resolvido não duplicam equipamento nem desligam a luz. Nesta etapa, habilidades não consomem os itens carregáveis e não há pedidos, pontuação ou multiplayer em rede. Sair da fase reinicia o teste.

`AbilityActions.ts` compartilha as regras de inspeção, sensores, luz e paradas entre o laboratório e `RiskWorkflow.ts`. Este último contém a máquina de estados sem Three/React. `riskData.ts` define os três riscos e o desvio; a cena reaproveita `AbilityVisuals` para mostrar as intervenções. O React só recebe snapshots em ações, nunca por frame. `npm test` cobre o fluxo puro, papéis, troca de personagem, inventário, pausa e descarte de GPU.

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
