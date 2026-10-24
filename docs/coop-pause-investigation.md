# Investigação: pausa no coop e recuperação visual

Base analisada: main, commit 90c186c1fbe2198245c16fb8f0398164a1155098.

## Falhas confirmadas e corrigidas

- `GameCanvas` transmitia mudanças locais de pausa e aplicava a mensagem recebida ao outro jogador. O servidor alterava `room.paused` e descartava movimentos. Agora o menu é local e mensagens antigas de pausa não alteram a sala.
- `Game.changeStatus` pausava `GameSession` inclusive no coop. Agora `paused` representa o overlay local no coop: a sessão e a cena continuam recebendo atualizações, com input local limpo. Solo mantém a pausa anterior.
- A aba oculta interrompia o processamento. Há um timer de apoio sem renderização; a simulação coop usa passos de 1/60 s com recuperação limitada a 120 passos por chamada, preservando o saldo. O navegador ainda pode suspender completamente uma aba/processo.
- Publicação de pose agora continua com o menu aberto. Ações remotas continuam sendo processadas.
- A perda de conexão encerra e descarta a instância, em vez de deixá-la simulando atrás da tela de erro. Timer de apoio e ações diferidas são limpos no dispose.
- `setTutorialCollisionProtection(true)` descartava a referência de recuperação de colisão sem restaurar visibilidade, altura e inclinação. A restauração agora é centralizada, inclusive na expiração de uma task e no descarte. A inclinação também é zerada no respawn.
- O índice de definições de pedidos agora remove entradas expiradas e concluídas.

## Causa da mancha marrom: reproduzida no Chromium

A mancha é o `<div>` vazio do antigo `Toast` em `OrdersHud.tsx`, não um objeto Three.js.
O componente renderizava sempre o elemento, mesmo quando `feedback` era null. Ao confirmar
"Entendi · continuar", `dismissFeedback` removia o texto e `data-tone`. O cleanup matava a
animação GSAP durante a exibição, preservando seu estilo inline `opacity: 1`. Sem o tom
vermelho, voltava o fundo padrão marrom `#4a311c`.

Reprodução no navegador: penalizar XP, aguardar 350 ms e confirmar o modal. Dois segundos
depois o elemento estava vazio, ainda com opacidade 1, fundo `rgb(74, 49, 28)`, largura
46 px e altura 26 px (padding de 20/10 px e borda de 3 px). A captura reproduziu a mesma
cápsula sobre o personagem da imagem de referência.

`FeedbackToast.tsx` agora monta o aviso somente com texto válido, dá a cada sequência seu
próprio elemento/animação e desmonta após o fade. Dispensar o feedback desmonta o elemento
imediatamente e cancela sua animação. `.toast:empty` também impede que um aviso vazio
forme uma cápsula. A comparação visual após a correção mostrou o personagem sem o oval.

## Sincronização: requisito ainda pendente

O backend atual é um relay de posições/comandos, e cada navegador simula `GameSession`, `OrlaPhase`, tráfego e mobilidade localmente. O tráfego também considera a personagem local. Os passos fixos reduzem diferenças de FPS; não transformam essa arquitetura em uma simulação autoritativa.

Portanto este patch NÃO garante igualdade integral de veículos, NPCs, eventos e resultados entre telas. Para isso é necessário definir uma autoridade de simulação, snapshots versionados do mundo, sequência/ack de comandos e reconciliação. O timer de aba oculta também não garante execução quando o navegador suspende o processo. São limitações explícitas, não validações concluídas.

## Validação

- `npm run typecheck`: aprovado.
- `npm test`: 190 testes aprovados; inclui transporte por WebSocket, isolamento de salas, pausa legada que não bloqueia movimento, menu/blur sem congelar a sessão e recuperação visual interrompida.
- `npm run build`: aprovado.
- Chromium: reprodução visual antes/depois da mancha; confirmação imediata e após 100/350/1700 ms, movimento normal/reduzido, substituição rápida de avisos, remoção ao terminar a animação, expiração e reinício.
- Não foi executada comparação multiplayer em dois navegadores. A sincronização integral foi retirada do escopo pelo solicitante nesta etapa.

A alteração de política de pausa inclui backend e frontend: publicar ambos para manter clientes antigos consistentes.
