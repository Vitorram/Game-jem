'use client';
import { useEffect, useState } from 'react';
import { loadAudioPreferences, saveAudioPreferences, type AudioPreferences } from '@/game/audio/audioPreferences';
export default function AudioControls() {
  const [settings, setSettings] = useState<AudioPreferences>({ music: 0.45, effects: 0.35, muted: false });
  useEffect(() => setSettings(loadAudioPreferences()), []);
  const update = (patch: Partial<AudioPreferences>) => {
    const next = { ...settings, ...patch };
    setSettings(next); saveAudioPreferences(next);
  };
  return <fieldset style={{ border: 0, padding: '12px 0', display: 'grid', gap: 12, minWidth: 0 }}>
    <legend>Áudio</legend>
    {(['music', 'effects'] as const).map(key => <label key={key} style={{ display: 'grid', gap: 6 }}>
      <span>{key === 'music' ? 'Música' : 'Efeitos sonoros'} · {Math.round(settings[key] * 100)}%</span>
      <input type="range" min="0" max="100" value={Math.round(settings[key] * 100)} onChange={event => update({ [key]: Number(event.target.value) / 100 })} />
    </label>)}
    <label><input type="checkbox" checked={settings.muted} onChange={event => update({ muted: event.target.checked })} /> Silenciar tudo</label>
  </fieldset>;
}
