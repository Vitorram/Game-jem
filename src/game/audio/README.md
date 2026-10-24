# Áudio do SUBURBAN

As faixas já estão em `public/assets/audio/` e tocam em loop:

| Tela / estado | Faixa |
| --- | --- |
| Menu inicial, incluindo configurações e créditos | Intro.mp3 |
| Preparação, história e os três tutoriais | Carregamento.mp3 |
| Partida após concluir ou pular o tutorial | Gameplay Default.mp3 |
| Pausa ou aba oculta | Suspende; retoma do mesmo ponto |
| Resultado / erro / saída | Para a faixa |

`Gameplay Speed.mp3` continua disponível no controlador, mas não é acionada automaticamente: a música 3 permanece durante toda a gameplay.

O navegador pode exigir um clique ou tecla antes de liberar o som. A integração tenta novamente na interação seguinte. Trocar de faixa encerra a anterior e faz uma entrada suave de 500 ms, sem sobreposição entre telas.

## Controles e efeitos

Configurações do menu e da pausa têm volume separado de música e efeitos, além de “Silenciar tudo”. As preferências ficam salvas neste navegador. Silenciar funciona também durante a entrada suave.

Os efeitos são sintetizados com Web Audio, sem arquivos ou dependências adicionais:

- Moedas: evento `order-completed`, ao concluir um chamado.
- Notificação: `order-arrived`.
- Aviso: pedido expirado, penalidade ou aviso de XP.
- Buzina: durante a partida, se uma via tiver pelo menos três veículos e congestionamento >= 70%, no máximo uma vez a cada oito segundos.

Efeitos não são reproduzidos durante tutorial, pausa ou com a aba oculta. Avisos antigos não se repetem ao retomar. O feedback usa o evento prioritário já publicado pelo `sessionStore`.

## Integração com a Pessoa 1

`useGameAudio` observa os estados existentes; não altera relógio, pontuação, vitória, derrota ou tutorial. `musicForState` centraliza a escolha da faixa. Quando a Pessoa 1 atualizar o encerramento, deve manter/publicar `finished` no Game ou na sessão. Se criar outros estados, atualizar esse mapeamento e seus testes. Não há fanfarra de vitória/derrota enquanto essas regras não estiverem definidas.

## Validação

- `node --test tests/audio.cjs`: transições, loop, trocas rápidas, mute no fade, pausa/retomada, autoplay, efeitos e limite de buzinas.
- `npm run typecheck` e `npm run build`.
- Conferência manual antes da demonstração: abrir menu e interagir para liberar som; iniciar; percorrer os três tutoriais; concluir ou pular; pausar e ajustar volumes; trocar de aba; concluir chamado; encerrar e voltar ao menu.

Os testes de áudio usam dublês de HTMLAudioElement e Web Audio; não substituem a escuta em navegador/dispositivo real.
