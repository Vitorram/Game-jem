'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { COOP_MAX_PLAYERS, COOP_MIN_PLAYERS, coopTeamMode, type CoopConnectionState, type CoopMessage, type CoopRole, type CoopRoom, type CoopRoomListing, type CoopTeamMode, getCoopClient } from '@/game/coop/CoopClient';
import styles from './CoopLobby.module.css';

const roleInfo: Record<CoopRole, { title: string; summary: string; focus: string; portrait: string }> = {
  analista: { title: 'Analista', focus: 'CENTRAL DE OPERAÇÕES', summary: 'Lê os chamados e coordena a resposta das equipes.', portrait: '/assets/characters/analista.png' },
  mobilidade: { title: 'Mobilidade', focus: 'TRÂNSITO E TRAVESSIAS', summary: 'Organiza o fluxo e protege ciclistas e pedestres.', portrait: '/assets/characters/mobilidade.png' },
  infraestrutura: { title: 'Infraestrutura', focus: 'REPAROS DA CIDADE', summary: 'Conserta semáforos, sensores e carregadores.', portrait: '/assets/characters/infra.png' },
};
const roles: CoopRole[] = ['analista', 'mobilidade', 'infraestrutura'];
type LobbyScreen = 'home' | 'browse' | 'code';
/** O servidor envia o modo; o cálculo local cobre mensagens sem o campo. */
const modeOf = (room: Pick<CoopRoom, 'players' | 'mode'>): CoopTeamMode | null => room.mode !== undefined ? room.mode : coopTeamMode(room.players);
function teamStatus(room: CoopRoom, mode: CoopTeamMode | null): { title: string; detail: string } {
  const count = room.players.length;
  const choosing = room.players.filter(player => !player.role).length;
  if (count < COOP_MIN_PLAYERS) return { title: `${count}/${COOP_MAX_PLAYERS} pessoas · falta pelo menos mais uma`, detail: 'A partida começa com 2 ou 3 pessoas. Em dupla, escolham Mobilidade e Infraestrutura: as funções da Analista ficam no tablet das duas.' };
  if (choosing) return { title: `${count}/${COOP_MAX_PLAYERS} pessoas · escolham as personagens`, detail: 'Cada pessoa escolhe uma vaga livre nos cards abaixo. Em dupla, fiquem com Mobilidade e Infraestrutura.' };
  if (mode === 'trio') return { title: `${count}/${COOP_MAX_PLAYERS} pessoas · equipe completa`, detail: 'Cada pessoa cuida de uma função: Analista, Mobilidade e Infraestrutura.' };
  if (mode === 'duo') return { title: `${count}/${COOP_MAX_PLAYERS} pessoas · dupla pronta para jogar`, detail: 'Mobilidade e Infraestrutura dividem a central da Analista: cada uma abre o próprio tablet. Uma terceira pessoa ainda pode entrar como Analista.' };
  return { title: `${count}/${COOP_MAX_PLAYERS} pessoas · ajuste os papéis`, detail: 'Em dupla a equipe precisa de Mobilidade e Infraestrutura. Quem está como Analista pode trocar de personagem nos cards abaixo, ou esperem a terceira pessoa.' };
}

export default function CoopLobby() {
  const router = useRouter();
  const client = useMemo(() => getCoopClient(), []);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
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
      if (message.type === 'joined') setMyId(message.id);
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
        if (!me?.role) { setError('Não encontrei seu papel na sala. Entre novamente.'); return; }
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

  // A personagem é escolhida dentro da sala, depois de ver quais vagas estão livres.
  const createRoom = () => void withConnection(() => client.createRoom(name, null, true));
  const joinByCode = () => {
    if (!code.trim()) { setError('Digite o código que a anfitriã compartilhou.'); return; }
    void withConnection(() => client.join(code, name));
  };
  const joinOpenRoom = (roomCode: string) => void withConnection(() => client.joinOpen(roomCode, name));
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

  const me = room?.players.find(player => player.id === myId);
  const myRole = me?.role ?? null;
  const isHost = me?.host ?? false;
  const isReady = me?.ready ?? ready;
  const mode = room ? modeOf(room) : null;
  const choosing = room ? room.players.filter(player => !player.role) : [];
  const allReady = !!room && mode !== null && room.players.every(player => player.ready);
  const status = room ? teamStatus(room, mode) : null;
  const chooseRole = (next: CoopRole) => void roomCommand(async () => { await client.setRole(next); setReady(false); });

  return <main className={styles.page}>
    <div className={styles.card}>
      <a className={styles.back} href="/">← Menu</a>
      <span className={styles.kicker}>SUBURBAN · COOP ONLINE</span>
      <div className={styles.connectionStatus} data-state={connection} role="status"><i aria-hidden="true" />{connection === 'connected' ? 'Conectada ao servidor' : connection === 'connecting' ? 'Conectando ao servidor…' : 'Sem conexão com o servidor'}</div>
      <h1>Uma cidade.<br /><em>Duas ou três pessoas.</em></h1>
      {!room && <p className={styles.lead}>Monte sua equipe para cuidar da Orla com 2 ou 3 pessoas: crie uma sala e compartilhe o código, entre em uma sala aberta ou use o código de alguém. A personagem você escolhe dentro da sala, vendo quais vagas estão livres.</p>}

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
        {status && <div className={styles.teamStatus} data-mode={mode ?? 'pending'} role="status"><b>{status.title}</b><span>{status.detail}</span></div>}
        <div className={styles.rolePicker} role="group" aria-label="Personagens da equipe">
          <div className={styles.rolePickerHeading}><b>{myRole ? 'Personagens da equipe' : 'Escolha sua personagem'}</b><small>{myRole ? 'Toque em uma vaga livre para trocar.' : 'Veja quem já está na sala e escolha uma vaga livre.'}</small></div>
          <div className={styles.roleCards}>
            {roles.map(candidate => {
              const character = roleInfo[candidate];
              const occupant = room.players.find(player => player.role === candidate);
              const mine = !!occupant && occupant.id === myId;
              // Em dupla a vaga da Analista não está "faltando": as duas pessoas a assumem pelo tablet.
              const sharedSlot = !occupant && candidate === 'analista' && mode === 'duo';
              const mark = mine ? '✓ Sua' : occupant ? 'Ocupada' : sharedSlot ? 'Compartilhada' : myRole ? 'Trocar' : 'Escolher';
              const detail = occupant ? `${occupant.name}${mine ? ' (você)' : ''}${occupant.host ? ' · anfitriã' : ''} · ${occupant.ready ? 'pronta' : 'se preparando'}`
                : sharedSlot ? 'Em dupla, Mobilidade e Infraestrutura usam o tablet desta função. Uma terceira pessoa ainda pode assumir.'
                  : character.summary;
              return <button type="button" key={candidate} disabled={busy || room.phase !== 'lobby' || !!occupant}
                className={`${styles.roleCard}${mine ? ` ${styles.roleCardSelected}` : occupant ? ` ${styles.roleCardTaken}` : ''}`}
                aria-pressed={mine} aria-label={`${character.title}: ${occupant ? `ocupada por ${occupant.name}` : 'vaga livre'}`}
                onClick={() => chooseRole(candidate)}>
                <span className={styles.rolePortrait}><Image src={character.portrait} alt="" fill sizes="(max-width: 600px) 96px, 120px" className={styles.rolePortraitImage} priority /></span>
                <span className={styles.roleCopy}><small>{character.focus}</small><b>{character.title}</b><span>{detail}</span></span>
                <span className={styles.roleSelectMark} aria-hidden="true">{mark}</span>
              </button>;
            })}
          </div>
          {choosing.length > 0 && <p className={styles.choosing}>Escolhendo personagem: {choosing.map(player => player.id === myId ? `${player.name} (você)` : player.name).join(', ')}</p>}
        </div>
        <div className={styles.lobbyActions}>
          <button className={styles.secondary} disabled={busy || room.phase !== 'lobby' || !myRole} onClick={() => void roomCommand(() => client.ready(!isReady))}>{!myRole ? 'Escolha uma personagem' : isReady ? 'Cancelar prontidão' : 'Estou pronta'}</button>
          {isHost && <button className={styles.primary} disabled={!allReady || busy || room.phase !== 'lobby'} onClick={() => void roomCommand(() => client.start())}>{room.phase !== 'lobby' ? 'Preparando partida…' : allReady ? mode === 'duo' ? 'Iniciar em dupla' : 'Iniciar partida' : room.players.length < COOP_MIN_PLAYERS ? 'Aguardando mais 1 pessoa' : choosing.length ? 'Aguardando as escolhas' : !mode ? 'Ajuste os papéis da dupla' : 'Aguardando todas ficarem prontas'}</button>}
          {!isHost && <p>A anfitriã inicia quando a equipe tiver 2 ou 3 pessoas prontas.</p>}
        </div>
      </section> : <>
        <div className={styles.setup}>
          <label className={styles.nameField}>Como podemos te chamar?<input value={name} maxLength={24} placeholder="Seu nome na equipe" onChange={event => setName(event.target.value)} /></label>
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
            const openSlots = COOP_MAX_PLAYERS - openRoom.players.length;
            const taken = openRoom.players.flatMap(player => player.role ? [player.role] : []);
            const undecided = openRoom.players.length - taken.length;
            const lineup = [...taken.map(role => roleInfo[role].title), ...(undecided ? [`${undecided} escolhendo`] : [])].join(' · ');
            return <article className={styles.openRoom} key={openRoom.code}>
              <div className={styles.openRoomPortraits}>{taken.map(role => <Image key={role} src={roleInfo[role].portrait} alt="" width={34} height={34} className={styles.openRoomAvatar} />)}</div>
              <div className={styles.openRoomInfo}><b>Sala de {hostPlayer?.name ?? 'equipe da Orla'}</b><span>{openRoom.players.length}/{COOP_MAX_PLAYERS} pessoas · {openSlots} {openSlots === 1 ? 'vaga' : 'vagas'}{modeOf(openRoom) === 'duo' ? ' · dupla já pode jogar' : ''}</span><small>{lineup}</small></div>
              <button className={styles.joinButton} disabled={busy || !name.trim() || openRoom.players.length >= COOP_MAX_PLAYERS} onClick={() => joinOpenRoom(openRoom.code)}>Entrar</button>
            </article>;
          })}</div> : <div className={styles.emptyRooms}><b>Nenhuma sala aberta por enquanto</b><span>Crie a primeira ou atualize a lista daqui a pouco.</span></div>}
        </section>}

        {screen === 'code' && <form className={styles.codeForm} onSubmit={event => { event.preventDefault(); joinByCode(); }}>
          <label>Código da sala<input autoFocus value={code} maxLength={8} placeholder="Ex.: 4A2F9C" onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
          <button className={styles.primary} disabled={busy || !name.trim() || !code.trim()} type="submit">Entrar na sala</button>
        </form>}
      </>}

      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.footer}>Jogue com 2 ou 3 pessoas. Em trio: Analista, Mobilidade e Infraestrutura. Em dupla: Mobilidade e Infraestrutura, com o tablet da Analista para as duas. As personagens são escolhidas dentro da sala; o prólogo e o tutorial começam quando todas estiverem prontas.</footer>
    </div>
  </main>;
}
