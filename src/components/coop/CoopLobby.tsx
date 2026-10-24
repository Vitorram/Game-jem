'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { type CoopConnectionState, type CoopMessage, type CoopRole, type CoopRoom, type CoopRoomListing, getCoopClient } from '@/game/coop/CoopClient';
import styles from './CoopLobby.module.css';

const roleInfo: Record<CoopRole, { title: string; summary: string; focus: string; portrait: string }> = {
  analista: { title: 'Analista', focus: 'CENTRAL DE OPERAÇÕES', summary: 'Lê os chamados e coordena a resposta das equipes.', portrait: '/assets/characters/analista.png' },
  mobilidade: { title: 'Mobilidade', focus: 'TRÂNSITO E TRAVESSIAS', summary: 'Organiza o fluxo e protege ciclistas e pedestres.', portrait: '/assets/characters/mobilidade.png' },
  infraestrutura: { title: 'Infraestrutura', focus: 'REPAROS DA CIDADE', summary: 'Conserta semáforos, sensores e carregadores.', portrait: '/assets/characters/infra.png' },
};
const roles: CoopRole[] = ['analista', 'mobilidade', 'infraestrutura'];
type LobbyScreen = 'home' | 'browse' | 'code';

export default function CoopLobby() {
  const router = useRouter();
  const client = useMemo(() => getCoopClient(), []);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<CoopRole>('analista');
  const [screen, setScreen] = useState<LobbyScreen>('home');
  const [room, setRoom] = useState<CoopRoom | null>(null);
  const [rooms, setRooms] = useState<CoopRoomListing[]>([]);
  const [myId, setMyId] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<CoopConnectionState>(client.state);
  const [listState, setListState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [listError, setListError] = useState('');
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (client.currentRoom) {
      const message = 'A sessão anterior foi encerrada. Crie ou entre em uma sala para jogar novamente.';
      client.disconnect(message); setConnection('disconnected'); setError(message);
      sessionStorage.removeItem('suburban-coop-session');
    }
  }, [client]);

  useEffect(() => {
    const onMessage = (message: CoopMessage) => {
      if (message.type === 'joined') { setMyId(message.id); setRole(message.role); }
      if (message.type === 'room') setRoom(message);
      if (message.type === 'rooms') { setRooms(message.rooms); setListState('loaded'); setListError(''); }
      if (message.type === 'connection') {
        setConnection(message.state);
        if (message.state === 'connected') setError('');
        if (message.state === 'disconnected') {
          setRoom(null); setMyId(''); setReady(false); setBusy(false); setRooms([]);
          sessionStorage.removeItem('suburban-coop-session');
          if (navigationTimer.current) clearTimeout(navigationTimer.current);
          if (message.message) { setError(message.message); setListState('error'); setListError(message.message); }
        }
      }
      if (message.type === 'session-ended') {
        if (navigationTimer.current) clearTimeout(navigationTimer.current);
        setRoom(null); setMyId(''); setReady(false); setError(message.message);
        sessionStorage.removeItem('suburban-coop-session');
      }
      if (message.type === 'error') { setError(message.message); setBusy(false); }
      if (message.type === 'game-start') {
        const me = message.players.find(player => player.id === myId);
        if (!me) { setError('Não encontrei seu papel na sala. Entre novamente.'); return; }
        try {
          sessionStorage.setItem('suburban-coop-session', JSON.stringify({
            room: message.room, playerId: me.id, role: me.role, name: me.name,
            serverUrl: client.url, players: message.players,
          }));
          navigationTimer.current = setTimeout(() => router.push('/jogo'), message.startDelayMs);
        } catch { client.disconnect('Permita o armazenamento da sessão no navegador para entrar no jogo.'); }
      }
    };
    client.on(onMessage);
    return () => { client.off(onMessage); if (navigationTimer.current) clearTimeout(navigationTimer.current); };
  }, [client, myId, router]);

  useEffect(() => {
    if (screen !== 'browse' || room) return;
    let active = true;
    setListState('loading'); setListError('');
    const refresh = async () => {
      try {
        await client.connect();
        if (active) await client.requestRooms();
      } catch (cause) {
        if (active) { setListState('error'); setListError(cause instanceof Error ? cause.message : 'Não foi possível carregar as salas abertas.'); }
      }
    };
    void refresh();
    return () => { active = false; };
  }, [client, screen, room]);

  const withConnection = async (action: () => Promise<void>) => {
    if (!name.trim()) { setError('Escolha um nome para entrar na partida.'); return; }
    setError(''); setBusy(true);
    try { await client.connect(); await action(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível conectar ao servidor coop.');
    } finally { setBusy(false); }
  };
  const roomCommand = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'A operação falhou.'); }
    finally { setBusy(false); }
  };
  const refreshRooms = async () => {
    setListState('loading'); setListError('');
    try { await client.connect(); await client.requestRooms(); }
    catch (cause) { setListState('error'); setListError(cause instanceof Error ? cause.message : 'Não foi possível carregar as salas.'); }
  };

  const createRoom = () => void withConnection(() => client.createRoom(name, role, true));
  const joinByCode = () => {
    if (!code.trim()) { setError('Digite o código que a anfitriã compartilhou.'); return; }
    void withConnection(() => client.join(code, name, role));
  };
  const joinOpenRoom = (roomCode: string) => void withConnection(() => client.joinOpen(roomCode, name, role));
  const leaveRoom = () => {
    client.disconnect();
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    sessionStorage.removeItem('suburban-coop-session');
    setRoom(null); setMyId(''); setReady(false); setBusy(false); setScreen('home'); setError(''); setCopied(false);
  };
  const copyCode = async () => {
    if (!room) return;
    try { await navigator.clipboard.writeText(room.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setError('Não consegui copiar. Selecione o código e copie manualmente.'); }
  };

  const isHost = room?.players.find(player => player.id === myId)?.host ?? false;
  const isReady = room?.players.find(player => player.id === myId)?.ready ?? ready;
  const allReady = !!room && room.players.length === 3 && new Set(room.players.map(player => player.role)).size === 3 && room.players.every(player => player.ready);
  const slots = room ? roles.map(candidate => ({ role: candidate, player: room.players.find(player => player.role === candidate) })) : [];

  return <main className={styles.page}>
    <div className={styles.card}>
      <a className={styles.back} href="/">← Menu</a>
      <span className={styles.kicker}>SUBURBAN · COOP ONLINE</span>
      <div className={styles.connectionStatus} data-state={connection} role="status"><i aria-hidden="true" />{connection === 'connected' ? 'Conectada ao servidor' : connection === 'connecting' ? 'Conectando ao servidor…' : 'Sem conexão com o servidor'}</div>
      <h1>Uma cidade.<br /><em>Três equipes.</em></h1>
      {!room && <p className={styles.lead}>Monte sua equipe para cuidar da Orla: crie uma sala e compartilhe o código, entre em uma sala aberta ou use o código de alguém.</p>}

      {room ? <section className={styles.lobby} aria-label="Sala cooperativa">
        <div className={styles.roomTopline}><div><small>SALA DE OPERAÇÕES</small><h2>Sua equipe está chegando</h2></div><button className={styles.textButton} onClick={leaveRoom}>Sair da sala</button></div>
        <div className={styles.roomCode}>
          <div><small>CÓDIGO DA SALA</small><b>{room.code}</b><span>Compartilhe para chamar sua equipe.</span></div>
          <button className={styles.secondary} onClick={() => void copyCode()}>{copied ? 'Código copiado!' : 'Copiar código'}</button>
        </div>
        <div className={styles.visibilityRow}>
          <span className={room.isPublic ? styles.publicBadge : styles.privateBadge}>{room.isPublic ? 'SALA ABERTA' : 'SÓ COM CÓDIGO'}</span>
          {isHost && <button className={styles.textButton} disabled={busy || room.phase !== 'lobby'} onClick={() => void roomCommand(() => client.setPublic(!room.isPublic))}>{room.isPublic ? 'Tornar privada' : 'Mostrar nas salas abertas'}</button>}
        </div>
        <div className={styles.players} aria-label="Vagas da equipe">
          {slots.map(({ role: candidate, player }) => {
            const character = roleInfo[candidate];
            return <article className={`${styles.playerSlot}${player ? '' : ` ${styles.playerSlotEmpty}`}`} key={candidate}>
              <span className={styles.avatar}><Image src={character.portrait} alt={`Retrato da equipe de ${character.title}`} fill sizes="64px" className={styles.avatarImage} /></span>
              <div><small>{character.focus}</small><b>{player?.name ?? character.title}{player?.id === myId ? ' (você)' : ''}</b><span>{character.title}{player?.host ? ' · Anfitriã' : player ? ' · Na equipe' : ' · Aguardando alguém'}</span></div>
              <span className={player?.ready ? styles.ready : styles.waiting}>{player ? player.ready ? 'Pronta' : 'Chegou' : 'Vaga aberta'}</span>
            </article>;
          })}
        </div>
        <div className={styles.lobbyActions}>
          <button className={styles.secondary} disabled={busy || room.phase !== 'lobby'} onClick={() => void roomCommand(() => client.ready(!isReady))}>{isReady ? 'Cancelar prontidão' : 'Estou pronta'}</button>
          {isHost && <button className={styles.primary} disabled={!allReady || busy || room.phase !== 'lobby'} onClick={() => void roomCommand(() => client.start())}>{room.phase !== 'lobby' ? 'Preparando partida…' : allReady ? 'Iniciar partida' : room.players.length < 3 ? 'Aguardando as 3 equipes' : 'Aguardando todas ficarem prontas'}</button>}
          {!isHost && <p>A anfitriã inicia quando as três pessoas estiverem prontas.</p>}
        </div>
      </section> : <>
        <div className={styles.setup}>
          <label className={styles.nameField}>Como podemos te chamar?<input value={name} maxLength={24} placeholder="Seu nome na equipe" onChange={event => setName(event.target.value)} /></label>
          <div className={styles.rolePicker} role="group" aria-label="Escolha sua personagem e sua função">
            <div className={styles.rolePickerHeading}><b>Escolha seu papel</b><small>Uma personagem por vaga na equipe.</small></div>
            <div className={styles.roleCards}>
              {roles.map(candidate => {
                const character = roleInfo[candidate];
                const selected = role === candidate;
                return <button type="button" key={candidate} disabled={busy} className={`${styles.roleCard}${selected ? ` ${styles.roleCardSelected}` : ''}`} aria-pressed={selected} onClick={() => setRole(candidate)}>
                  <span className={styles.rolePortrait}><Image src={character.portrait} alt={`Personagem de ${character.title}`} fill sizes="(max-width: 600px) 96px, 120px" className={styles.rolePortraitImage} priority /></span>
                  <span className={styles.roleCopy}><small>{character.focus}</small><b>{character.title}</b><span>{character.summary}</span></span>
                  <span className={styles.roleSelectMark} aria-hidden="true">{selected ? '✓ Escolhida' : 'Escolher'}</span>
                </button>;
              })}
            </div>
          </div>
        </div>

        <nav className={styles.entryChoices} aria-label="Opções de partida">
          <button className={styles.primary} disabled={busy || !name.trim()} onClick={createRoom}><b>{busy ? 'Aguardando servidor…' : 'Criar sala'}</b><span>Gera um código para compartilhar</span></button>
          <button className={styles.choiceButton} onClick={() => { setError(''); setScreen(screen === 'browse' ? 'home' : 'browse'); }}><b>Salas abertas</b><span>Encontre uma equipe com vaga</span></button>
          <button className={styles.choiceButton} onClick={() => { setError(''); setScreen(screen === 'code' ? 'home' : 'code'); }}><b>Entrar com código</b><span>Jogue com alguém que te chamou</span></button>
        </nav>

        {screen === 'browse' && <section className={styles.browser} aria-label="Salas abertas">
          <div className={styles.browserHeading}><div><small>PARTIDAS DISPONÍVEIS</small><h2>Salas abertas</h2></div><button className={styles.textButton} disabled={listState === 'loading' || busy} onClick={() => void refreshRooms()}>Atualizar lista ↻</button></div>
          {listState === 'loading' || listState === 'idle' ? <div className={styles.emptyRooms} role="status"><b>Buscando equipes…</b><span>Consultando as salas do servidor.</span></div>
            : listState === 'error' ? <div className={styles.listError} role="alert"><b>Não foi possível buscar as salas</b><span>{listError}</span><button className={styles.secondary} onClick={() => void refreshRooms()}>Tentar novamente</button></div>
            : rooms.length ? <div className={styles.openRooms}>{rooms.map(openRoom => {
            const hostPlayer = openRoom.players.find(player => player.host);
            const roleTaken = openRoom.players.some(player => player.role === role);
            return <article className={styles.openRoom} key={openRoom.code}>
              <div className={styles.openRoomPortraits}>{openRoom.players.map(player => <Image key={player.id} src={roleInfo[player.role].portrait} alt="" width={34} height={34} className={styles.openRoomAvatar} />)}</div>
              <div className={styles.openRoomInfo}><b>Sala de {hostPlayer?.name ?? 'equipe da Orla'}</b><span>{openRoom.players.length}/3 pessoas · {3 - openRoom.players.length} {openRoom.players.length === 2 ? 'vaga' : 'vagas'}</span><small>{openRoom.players.map(player => roleInfo[player.role].title).join(' · ')}</small></div>
              <button className={styles.joinButton} disabled={busy || !name.trim() || roleTaken || openRoom.players.length >= 3} title={roleTaken ? 'Escolha um papel livre nos cards acima.' : undefined} onClick={() => joinOpenRoom(openRoom.code)}>{roleTaken ? 'Papel ocupado' : 'Entrar'}</button>
            </article>;
          })}</div> : <div className={styles.emptyRooms}><b>Nenhuma sala aberta por enquanto</b><span>Crie a primeira ou atualize a lista daqui a pouco.</span></div>}
        </section>}

        {screen === 'code' && <form className={styles.codeForm} onSubmit={event => { event.preventDefault(); joinByCode(); }}>
          <label>Código da sala<input autoFocus value={code} maxLength={8} placeholder="Ex.: 4A2F9C" onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
          <button className={styles.primary} disabled={busy || !name.trim() || !code.trim()} type="submit">Entrar na sala</button>
        </form>}
      </>}

      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.footer}>A equipe tem três vagas: Analista, Mobilidade e Infraestrutura. O prólogo e o tutorial começam quando todas estiverem prontas.</footer>
    </div>
  </main>;
}
