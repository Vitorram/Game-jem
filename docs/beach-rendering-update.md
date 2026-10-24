# Praia contínua e redução de chamadas de desenho

Base: main `86eed0f2c0e2000fdaf25037d034abeb70c31ee9`.

## Mudanças visuais

O mar anterior alternava materiais em tiles quadrados; a areia molhada e a espuma também eram retângulos por coluna. A nova superfície é contínua, com uma costa curva em coordenadas do mundo, gradiente entre água profunda/rasa, areia seca/molhada, pequenas ondulações e espuma animada. Usa um material padrão iluminado do Three.js com shader complementar, preservando o recebimento das sombras do cenário. Não adiciona imagens, downloads, reflexos em tempo real ou pós-processamento.

Os pisos antigos permanecem como referências da grade, mas os trechos cobertos não são desenhados. A grade física, obstáculos, posições de missões e circulação não foram alterados.

## Otimização

Peças estáticas opacas com a mesma geometria/material são desenhadas como InstancedMesh, agrupadas em regiões de 16 m para manter o descarte de regiões fora da câmera. Personagens, veículos, boias, barcos e espuma antiga animada ficam fora desses lotes. Os nós de origem continuam disponíveis para consultas e testes. Buffers das instâncias são descartados separadamente, sem descartar duas vezes geometrias e materiais compartilhados.

## Comparação controlada no Chromium

Mesmo viewport 1280×800, câmera, semente, cena e 1.200 passos de 1/60 s. A versão anterior usa o GridMapView original da base; o restante do motor é igual. As capturas de visão ampla foram inspecionadas lado a lado. Não houve erro de compilação do shader ou erro de página.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| Chamadas de desenho, câmera de gameplay | 2.796 | 1.719 |
| Chamadas de desenho, visão ampla | 2.839 | 1.791 |
| Triângulos, câmera de gameplay | 383.796 | 430.572 |
| Texturas enviadas ao renderer na amostra | 23 | 17 |
| Geometrias no renderer na amostra | 163 | 164 |
| CPU média por atualização na amostra | 0,159 ms | 0,152 ms |

São aproximadamente 38,5% menos chamadas de desenho na câmera de gameplay. Há um custo explícito: cerca de 12,2% mais triângulos, pela nova superfície e pelo descarte por lote em vez de por peça. Os lotes são regionais para limitar esse custo. Não é uma promessa universal de melhoria de FPS.

Uma amostra curta de renderização em SwiftShader foi de 7,7 para 11,1 FPS. Trata-se de renderização por software neste ambiente, com poucos segundos de amostra; não equivale a hardware de jogador nem valida 60 FPS. Os contadores estruturais são evidência mais forte do que esse FPS.

## Validação

- 201 testes aprovados; TypeScript e build de produção aprovados.
- As suítes de campanha, colisões, trânsito, missão, pausa e reinício continuam passando.
- Novos testes verificam transformações de instâncias, exclusão de objetos animados/transparentes/ocultos, divisão espacial de lotes e descarte único dos recursos da praia.
- Três reconstruções consecutivas estabilizaram em 165 geometrias e 18 texturas; não houve crescimento desses contadores.
- Shader animado altera apenas um uniform por quadro, sem recriar malhas ou materiais.

Uma verificação em GPU real, especialmente em celular, continua recomendada para confirmar o custo gráfico da nova água e escolher o tamanho ideal dos lotes. A sincronização multiplayer não faz parte desta mudança.
