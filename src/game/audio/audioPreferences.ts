import { gameMusic } from './musicManager';
import { gameSounds } from './soundEffects';
export type AudioPreferences = { music: number; effects: number; muted: boolean };
const defaults: AudioPreferences = { music: 0.45, effects: 0.35, muted: false };
export function loadAudioPreferences(): AudioPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem('suburban-audio') ?? '{}');
    const volume = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
    return { music: volume(saved.music, defaults.music), effects: volume(saved.effects, defaults.effects), muted: saved.muted === true };
  } catch { return { ...defaults }; }
}
export function applyAudioPreferences(value: AudioPreferences) {
  gameMusic.setVolume(value.music); gameMusic.setMuted(value.muted);
  gameSounds.setVolume(value.effects); gameSounds.setMuted(value.muted);
}
export function saveAudioPreferences(value: AudioPreferences) {
  applyAudioPreferences(value);
  try { localStorage.setItem('suburban-audio', JSON.stringify(value)); } catch {}
}
