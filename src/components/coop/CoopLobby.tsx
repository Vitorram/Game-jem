'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CoopClient, type CoopMessage, type CoopPlayer, type CoopRole, getCoopClient } from '@/game/coop/CoopClient';
import styles from './CoopLobby.module.css';

const roleInfo: Record<CoopRole, { title: string; summary: string }> = {
  analista: { title: 'Analista', summary: 'Lê chamados, identifica riscos e coordena as duas equipes.' },
  mobilidade: { title: 'Mobilidade', summary: 'Organiza a circulação, posiciona cones e mantém os pedestres seguros.' },
  infraestrutura: { title: 'Infraestrutura', summary: 'Vai até os equipamentos e executa os reparos da cidade.' },
};

export default function CoopLobby() {
  const router = useRouter();
  const client = useMemo(() => getCoopClient(), []);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<CoopRole>('analista');
  const [room, setRoom] = useState<{ code: string; phase: string; players: CoopPlayer[] } | null>(null);
  const [myId, setMyId] = useState('');
  const [myRole, setMyRole] = useState<CoopRole | null>(null);
  const [host, setHost] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onMessage = (message: CoopMessage) => {
      if (message.type === 'joined') { setMyId(message.id); setMyRole(message.role); setHost(message.host); }
      if (message.type === 'room') setRoom({ code: message.code, phase: message.phase, players: message.players });
      if (message.type === 'error') { setError(message.message); setBusy(false); }
      if (message.type === 'game-start') {
        const me = message.players.find(player => player.id === myId);
        if (!me) { setError('Não encontrei seu papel na sala. Entre novamente.'); return; }
        sessionStorage.setItem('suburban-coop-session', JSON.stringify({
          room: message.room, playerId: me.id, role: me.role, name: me.name,
          serverUrl: client.url, players: message.players,
        }));
        window.setTimeout(() => router.push('/jogo'), message.startDelayMs);
      }
    };
    client.on(onMessage);
    return () => client.off(onMessage);
  }, [client, myId, router]);

  const joinRoom = async () => {
    setError(''); setBusy(true);
    try {
      await client.connect();
      client.join(code, name, role);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível conectar ao servidor coop.');
      setBusy(false);
    }
  };

  const isReady = room?.players.find(player => player.id === myId)?.ready ?? ready;
  const allReady = !!room && room.players.length === 3 && new Set(room.players.map(player => player.role)).size === 3 && room.players.every(player => player.ready);

  return <main className={styles.page}>
    <div className={styles.card}>
      <a className={styles.back} href="/">← Menu</a>
      <span className={styles.kicker}>SUBURBAN · COOP ONLINE</span>
      <h1>Uma cidade.<br /><em>Três equipes.</em></h1>
          <p className={styles.lead}>Coordenem análise, mobilidade e infraestrutura em uma única partida. Para esta fase, a equipe completa tem uma pessoa em cada papel; o prólogo e o tutorial só avançam quando todas estiverem prontas.</p>

      {!room ? <div className={styles.form}>
        <label>Seu nome<input value={name} maxLength={24} placeholder="Como te chamamos?" onChange={event => setName(event.target.value)} /></label>
        <label>Código da sala <small>Deixe em branco para criar uma sala</small><input value={code} maxLength={8} placeholder="Ex.: ORLA7" onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
        <label>Equipe<select value={role} onChange={event => setRole(event.target.value as CoopRole)}>
          {(Object.keys(roleInfo) as CoopRole[]).map(candidate => <option key={candidate} value={candidate}>{roleInfo[candidate].title}</option>)}
        </select></label>
        <div className={styles.roleDescription}>{roleInfo[role].summary}</div>
        <button className={styles.primary} disabled={busy || !name.trim()} onClick={() => void joinRoom()}>{busy ? 'Conectando…' : code ? 'Entrar na sala' : 'Criar sala'}</button>
      </div> : <section className={styles.lobby}>
        <div className={styles.roomCode}><small>CÓDIGO DA SALA</small><b>{room.code}</b><span>Compartilhe este código com sua equipe.</span></div>
        <div className={styles.players}>
          {room.players.map(player => <article className={styles.player} key={player.id}>
            <span className={styles.avatar}>{player.role === 'analista' ? 'A' : player.role === 'mobilidade' ? 'M' : 'I'}</span>
            <div><b>{player.name}{player.id === myId ? ' (você)' : ''}</b><small>{roleInfo[player.role].title}{player.host ? ' · anfitriã' : ''}</small></div>
            <span className={player.ready ? styles.ready : styles.waiting}>{player.ready ? 'Pronta' : 'Aguardando'}</span>
          </article>)}
          {room.players.length < 3 && <div className={styles.empty}>Aguardando mais uma pessoa… ({room.players.length}/3)</div>}
        </div>
        <div className={styles.lobbyActions}>
          <button className={styles.secondary} onClick={() => { const next = !isReady; setReady(next); client.ready(next); }}>{isReady ? 'Cancelar prontidão' : 'Estou pronta'}</button>
          {host && <button className={styles.primary} disabled={!allReady} onClick={() => client.start()}>{allReady ? 'Iniciar partida juntas' : room.players.length < 3 ? 'Aguardando as três equipes' : 'Aguardando todas ficarem prontas'}</button>}
          {!host && <p>A anfitriã iniciará quando todas estiverem prontas.</p>}
        </div>
      </section>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.footer}>A partida funciona pela rede local ou por um servidor acessível a todas. Para jogar em computadores diferentes, configure o endereço público do servidor coop.</footer>
    </div>
  </main>;
}
