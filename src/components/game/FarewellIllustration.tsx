import styles from './OrdersHud.module.css';

const characters = [
  { name: 'Infraestrutura', x: 86, skin: '#dca47b', hair: '#302921', shirt: '#28654c', pants: '#34445b', wave: -1, style: 'curly' },
  { name: 'Mobilidade', x: 180, skin: '#d5a17d', hair: '#211913', shirt: '#6545b5', pants: '#34304e', wave: 1, style: 'cap' },
  { name: 'Analista', x: 274, skin: '#e6b38d', hair: '#244dad', shirt: '#c85c2f', pants: '#293345', wave: -1, style: 'blue' },
] as const;

export default function FarewellIllustration({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 360 170" role="img" aria-label="Os três personagens acenam para se despedir">
      <rect x="8" y="8" width="344" height="154" rx="26" fill="#e9f0d9" />
      <circle cx="319" cy="34" r="13" fill="#ffd46d" />
      <path d="M18 127 Q82 109 145 126 T272 124 T342 126 V154 H18Z" fill="#d4e5c2" />
      <path d="M36 35l4 8m-4-8 8-3M168 23l3 8m-3-8 8-4M302 70l5 7m-5-7 8-2" stroke="#efad54" strokeWidth="3" strokeLinecap="round" />

      {characters.map(character => {
        const shoulderX = character.x + character.wave * 18;
        const elbowX = character.x + character.wave * 38;
        const handX = character.x + character.wave * 35;
        return (
          <g key={character.name} aria-hidden="true">
            <ellipse cx={character.x} cy="146" rx="27" ry="5" fill="#59785e" opacity=".22" />
            <path d={`M${character.x - 8} 121l-2 18m18-18 2 18`} fill="none" stroke={character.pants} strokeWidth="11" strokeLinecap="round" />
            <path d={`M${character.x - 14} 139h8m12 0h8`} fill="none" stroke="#4a382f" strokeWidth="7" strokeLinecap="round" />
            <path d={`M${character.x - 19} 88Q${character.x - 34} 99 ${character.x - 29} 114`} fill="none" stroke={character.shirt} strokeWidth="12" strokeLinecap="round" />
            <circle cx={character.x - 29} cy="116" r="6" fill={character.skin} />
            <rect x={character.x - 21} y="76" width="42" height="49" rx="14" fill={character.shirt} />
            <path d={`M${shoulderX} 87Q${elbowX} 69 ${handX} 41`} fill="none" stroke={character.shirt} strokeWidth="12" strokeLinecap="round" />
            <g className={styles.farewellWaveHand}>
              <circle cx={handX} cy="36" r="7" fill={character.skin} />
              <path d={`M${handX - 4} 33v-7m4 7v-9m4 9v-7`} stroke={character.skin} strokeWidth="2.5" strokeLinecap="round" />
            </g>
            <circle cx={character.x} cy="54" r="18" fill={character.skin} />
            {character.style === 'curly' && <g fill={character.hair}>
              <circle cx={character.x - 13} cy="42" r="7" /><circle cx={character.x - 4} cy="36" r="8" />
              <circle cx={character.x + 6} cy="37" r="8" /><circle cx={character.x + 14} cy="44" r="7" />
              <path d={`M${character.x - 18} 48q18-8 36 0v-5q-18-20-36 0z`} />
            </g>}
            {character.style === 'cap' && <g>
              <path d={`M${character.x - 17} 49q1-19 17-19t18 19q-17-6-35 0`} fill={character.hair} />
              <path d={`M${character.x - 19} 43q17-13 36 0l5 5q-20-5-42 2z`} fill="#7863ca" />
            </g>}
            {character.style === 'blue' && <path d={`M${character.x - 18} 51q-1-22 17-22 15 0 20 16-9-5-17-4-8 1-20 10`} fill={character.hair} />}
            <circle cx={character.x - 6} cy="55" r="1.7" fill="#382c28" />
            <circle cx={character.x + 6} cy="55" r="1.7" fill="#382c28" />
            <path d={`M${character.x - 5} 63q5 4 10 0`} fill="none" stroke="#8f5147" strokeWidth="2" strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
}
