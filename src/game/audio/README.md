# Trilha sonora do SUBURBAN — integração independente

Este módulo **não está ligado às telas ou cenas** para evitar conflitos com os trabalhos em outras branches.

## Arquivos de áudio esperados

Copiar os quatro MP3 originais para `public/assets/audio/` mantendo estes nomes:

- `Intro.mp3` — menu/tela inicial
- `Carregamento.mp3` — carregamento
- `Gameplay Default.mp3` — jogo normal
- `Gameplay Speed.mp3` — jogo caótico/pressão

**Atenção:** os MP3 ainda precisam ser adicionados à branch. O gerenciador de áudio está pronto, mas as faixas não foram enviadas por limitação de upload binário da integração utilizada.

## Uso após adicionar os MP3

```ts
import { gameMusic } from "@/game/audio/musicManager";

await gameMusic.play("intro"); // após interação do usuário
await gameMusic.play("loading");
await gameMusic.play("gameplay");
await gameMusic.play("gameplaySpeed", 900);
gameMusic.setVolume(0.35);
gameMusic.setMuted(true);
gameMusic.stop();
```

Cada arquivo é reproduzido em loop. A duração da fase **não** precisa corresponder à duração da faixa. O jogo é responsável por escolher o momento de trocar de faixa — por exemplo, ao iniciar uma fase, restarem 30 segundos ou aumentar o nível de caos.

Navegadores bloqueiam reprodução automática até uma interação do usuário; trate erros de `play` e inicie a trilha em um clique de entrada no jogo.

**Checklist para revisar antes do merge:** enviar os quatro MP3; testar caminhos e loops; disparar cues de acordo com o estado real das fases; validar transições, pausa e controles de volume. Não realizar merge antes disso.
