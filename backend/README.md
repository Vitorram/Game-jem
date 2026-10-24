# Coop online

O servidor mantém as salas e retransmite posição dos personagens, ações compartilhadas e pausas para até três navegadores. O relógio da sala envia uma contagem regressiva comum para iniciar as simulações juntas.

## Iniciar localmente

No PowerShell, na pasta do projeto:

```powershell
py -m pip install -r backend/requirements.txt
py backend/server.py
```

Em outro terminal, rode `npm run dev` e abra `/jogo`. No prólogo, escolha **Coop online**. Compartilhe o código da sala, escolha um personagem por pessoa e marque todos como prontos.

Para testar em outros computadores da mesma rede, rode o Next e este servidor usando o IP da máquina anfitriã. Configure `NEXT_PUBLIC_COOP_WS_URL` com `ws://IP_DA_MAQUINA:8765` antes de iniciar o Next. Em uma implantação HTTPS, a URL do WebSocket precisa usar `wss://`.

As salas ficam em memória e desaparecem quando todos saem ou o servidor é encerrado.
