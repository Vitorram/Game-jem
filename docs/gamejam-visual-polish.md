# Polimento visual para apresentação da gamejam

Base: main `ea6b01156ce6258132db60645e25bb9c01c6f416`.
Este PR depende da aprovação do solicitante antes de qualquer integração na main.

## Direção aplicada

Manter a linguagem de brinquedo/maquete da Orla, com uma identidade mais consistente e menos obstrução da cena. Não é uma garantia de colocação na gamejam; o julgamento e a experiência de quem joga continuam importantes.

- Guarda-sóis alternam setores coloridos e creme. As cores são atributos dos vértices, em geometrias em cache, sem criar uma chamada de desenho para cada listra.
- Toalhas discretas reforçam as áreas já ocupadas pelos guarda-sóis, sem novos obstáculos.
- A central da Analista ganhou bordas suavizadas e uma placa pintada “SUBURBAN · Central da Orla”, com a mesma paleta da interface. A placa é gerada localmente, sem imagem ou fonte externa.
- Seis gaivotas decorativas se movem sobre o mar com duas malhas instanciadas, sem partículas, colliders, timers ou criação de objetos por quadro.
- Avisos de semáforo/acidente/resgate são menores e usam teal, creme e amarelo/verde. O texto do resgate é exibido somente na mesma condição de conclusão já existente. Os materiais mantêm as cores de interface e não são estourados pela luz.
- O aviso de missão concluída ganhou um selo de confirmação. O ciclo de animação/remoção do toast é o mesmo já corrigido anteriormente.

## Validação

- 204 testes, TypeScript e build de produção aprovados.
- Os testes de campanha, pausa, inventário, colisões e trânsito continuam passando.
- Novos testes cobrem matrizes finitas das gaivotas, ausência de alteração do estado de jogo, descarte único, cache das geometrias listradas e configuração dos avisos compactos.
- Chromium: capturas comparadas em visão ampla e durante um chamado real de semáforo; sem erros de shader ou de página.
- Número de obstáculos do mapa: 114 antes e depois. A grade, posições, gatilhos e regras de missão não foram alterados.
- Três reconstruções consecutivas estabilizaram em 172 geometrias e 19 texturas; a base estabilizava em 166/18.

## Custo observado

Mesma câmera, viewport 1280×800, semente e 1.200 passos de simulação:

| Métrica | Main | PR |
| --- | ---: | ---: |
| Draw calls de gameplay | 1.719 | 1.733 |
| Triângulos de gameplay | 430.572 | 441.122 |
| Draw calls em visão ampla | 1.791 | 1.805 |
| Texturas na amostra inicial | 17 | 18 |
| Geometrias na amostra inicial | 164 | 170 |

São ~0,8% mais chamadas e ~2,5% mais triângulos. A placa adiciona uma textura; as gaivotas custam duas chamadas de desenho. Não foram adicionados bloom, SSAO, reflexos em tempo real ou pós-processamento.

Amostras curtas no renderer por software variaram de 11,3 FPS na base para 10,8 FPS no PR. Não são medições de hardware de jogador, não validam uma meta de 60 FPS e não sustentam uma conclusão forte sobre a diferença de FPS. A comparação de recursos/custo estrutural é mais confiável. Uma conferência em GPU real e celular continua útil.

## Revisão sugerida para a equipe

Abra o preview, observe a praia e a central, e provoque a primeira falha do semáforo. Confira se o aviso novo mantém a urgência sem esconder o caminho. Para a apresentação, uma captura curta alternando praia, central e uma missão concluída evidencia essas mudanças melhor que uma tomada parada.

Próximas oportunidades de maior impacto: testar o primeiro minuto com alguém que não conhece o jogo e ajustar a dificuldade/clareza com base nessa observação. Sincronização integral do coop continua fora deste PR.
