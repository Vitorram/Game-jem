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

## Imagem: conclusão limitada

Não foi identificado código que crie uma partícula/geometria marrom ao expirar uma task. `PlayerFeedback` é um anel e já possui dispose. A falha de restauração de colisão é reproduzível em teste, mas não foi comprovado que ela causa exatamente o oval da fotografia. Não foram removidas peças do modelo para esconder o sintoma.

## Sincronização: requisito ainda pendente

O backend atual é um relay de posições/comandos, e cada navegador simula `GameSession`, `OrlaPhase`, tráfego e mobilidade localmente. O tráfego também considera a personagem local. Os passos fixos reduzem diferenças de FPS; não transformam essa arquitetura em uma simulação autoritativa.

Portanto este patch NÃO garante igualdade integral de veículos, NPCs, eventos e resultados entre telas. Para isso é necessário definir uma autoridade de simulação, snapshots versionados do mundo, sequência/ack de comandos e reconciliação. O timer de aba oculta também não garante execução quando o navegador suspende o processo. São limitações explícitas, não validações concluídas.

## Validação

- `npm run typecheck`: aprovado.
- `npm test`: 189 testes aprovados; inclui transporte por WebSocket, isolamento de salas, pausa legada que não bloqueia movimento, menu/blur sem congelar a sessão e recuperação visual interrompida.
- `npm run build`: aprovado.
- Não foi executada uma comparação visual em dois navegadores reais nem reprodução visual da mancha original.

A alteração de política de pausa inclui backend e frontend: publicar ambos para manter clientes antigos consistentes.
