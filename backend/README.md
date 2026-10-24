# SUBURBAN Coop Server

Servidor de salas em tempo real para o modo cooperativo (3 pessoas, uma por papel). Não precisa instalar dependências adicionais; usa Node.js e WebSocket nativos.

## Desenvolvimento na mesma máquina

Em um terminal, na raiz do projeto:

```bash
npm run coop:server
```

Em outro terminal:

```bash
npm run dev
```

Abra `http://localhost:3000/coop` em três abas, crie uma sala na primeira e entre com o código nas outras. Cada participante fica com um papel diferente. Todas marcam **Estou pronta**; a anfitriã inicia. O prólogo ocorre em cada tela, e o tutorial apresenta as tarefas do papel de cada pessoa. A contagem, chamados e movimentação só começam quando todas confirmarem que estão prontas no tutorial.

## Conectar computadores na mesma rede

1. Descubra o endereço IP local do computador que vai hospedar o jogo.
2. Inicie o Next para aceitar conexões da rede: `npm run dev -- --hostname 0.0.0.0`.
3. Inicie o coop server com `COOP_HOST=0.0.0.0` e libere as portas 3000 e 3001 no firewall local.
4. Nas outras máquinas, configure `NEXT_PUBLIC_COOP_SERVER_URL=ws://IP-DO-HOST:3001/coop` antes de iniciar o Next. A variável é incorporada na build, então precisa ser definida antes de `npm run dev`/`npm run build`.
5. Abra `http://IP-DO-HOST:3000/coop` em cada máquina.

No PowerShell, pode iniciar o servidor com `$env:COOP_HOST='0.0.0.0'; npm run coop:server`. Para o Next, use `$env:NEXT_PUBLIC_COOP_SERVER_URL='ws://IP-DO-HOST:3001/coop'; npm run dev -- --hostname 0.0.0.0`.

Para uma implantação pública, publique o servidor atrás de um proxy TLS que encaminhe WebSocket `/coop` para a porta 3001 e configure o cliente com `wss://SEU-DOMINIO/coop`. O servidor mantém salas em memória; reiniciá-lo encerra as salas. O endpoint `/health` informa se está ativo.

## Estado sincronizado

O servidor coordena salas, papéis, prontidão, início e o bloqueio conjunto do tutorial, e transmite posições/ações entre participantes. A simulação 3D e o relógio continuam rodando nos navegadores; o servidor não é autoritativo nem persiste partidas. Este MVP destina-se a sessões pequenas e confiáveis (LAN ou servidor próprio); não inclui matchmaking público, reconexão após atualizar a página ou proteção contra clientes modificados.
