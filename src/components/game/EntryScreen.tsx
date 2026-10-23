'use client';

import Link from 'next/link';
import styles from './EntryScreen.module.css';

export default function EntryScreen({ ready, onStory, onLab }: { ready: boolean; onStory: () => void; onLab: () => void }) {
  return <div className={styles.screen}>
    <header><Link href="/">← Voltar</Link><span>SUBURBAN <i /> CENTRAL DE OPERAÇÕES</span></header>
    <main className={styles.content}>
      <p className={styles.eyebrow}>SELECIONE O MODO</p>
      <h1>A cidade está<br />nas suas mãos<span>.</span></h1>
      <div className={styles.choices}>
        <button className={styles.mission} disabled={!ready} onClick={onStory}>
          <div className={styles.mapArt} aria-hidden="true"><svg viewBox="0 0 600 190"><path d="M0 0H600V58Q380 25 240 65T0 35Z" fill="#496e6a" /><path d="M0 72Q180 111 300 74T600 82" stroke="#d9c99b" strokeWidth="14" fill="none" /><path d="M-20 145H620" stroke="#273e42" strokeWidth="49" /><path d="M-20 145H620" stroke="#e8cf95" strokeWidth="2" strokeDasharray="14 12" /><path d="M348 110V178m13-68v68m13-68v68m13-68v68" stroke="#e6dfc5" strokeWidth="7" /><rect x="105" y="128" width="28" height="12" rx="3" fill="#d7a568" /><rect x="445" y="151" width="33" height="12" rx="3" fill="#8ebeb0" /><circle cx="305" cy="96" r="18" stroke="#e8c77d" fill="#263b3a" strokeWidth="1.5" /><circle cx="305" cy="96" r="5" fill="#e8c77d" /></svg></div>
          <div className={styles.cardTop}><span>01 / HISTÓRIA</span><small>6 MIN · ORLA</small></div>
          <div className={styles.cardBottom}><span><strong>Jogar a fase</strong><small>Conheça a equipe. Assuma a operação.</small></span><b>↗</b></div>
        </button>
        <button className={styles.lab} disabled={!ready} onClick={onLab}>
          <div className={styles.puzzleArt} aria-hidden="true"><i>┏</i><i>━</i><i>┓</i><i>┃</i><i>●</i><i>┃</i></div>
          <div className={styles.cardTop}><span>02 / EXPLORAR</span><small>SEM PRESSA</small></div>
          <div className={styles.cardBottom}><span><strong>Área de testes</strong><small>Habilidades e puzzles. No seu ritmo.</small></span><b>↗</b></div>
        </button>
      </div>
      <footer><span><i />{ready ? 'SISTEMAS PRONTOS' : 'PREPARANDO A CIDADE…'}</span><span>ANALISAR · PROTEGER · RESOLVER</span></footer>
    </main>
  </div>;
}
