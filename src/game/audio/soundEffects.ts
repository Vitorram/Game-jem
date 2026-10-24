export type SoundCue = 'coin' | 'notification' | 'warning' | 'horn';
/** Short synthesized effects: no downloads, no recurring ambience timers. */
export class SoundEffects {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.35;
  private muted = false;
  private voices = new Set<OscillatorNode>();
  private lastPlayed = new Map<SoundCue, number>();

  unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.applyVolume();
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional on unsupported browsers. */ }
  }
  setVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }
  setMuted(muted: boolean) { this.muted = muted; this.applyVolume(); }
  play(cue: SoundCue) {
    const ctx = this.context;
    if (!ctx || !this.master || ctx.state !== 'running' || this.muted || !this.volume) return;
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(cue) ?? -Infinity) < (cue === 'horn' ? 8 : 0.25)) return;
    this.lastPlayed.set(cue, now);
    const notes = cue === 'coin' ? [988, 1319, 1760]
      : cue === 'notification' ? [523, 784]
        : cue === 'warning' ? [330, 220] : [349, 440];
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const envelope = ctx.createGain();
      const start = now + (cue === 'horn' ? 0 : index * 0.09);
      const end = start + (cue === 'horn' ? 0.22 : 0.13);
      osc.type = cue === 'horn' ? 'sawtooth' : 'sine';
      osc.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(cue === 'horn' ? 0.045 : 0.14, start + 0.015);
      envelope.gain.exponentialRampToValueAtTime(0.001, end);
      osc.connect(envelope); envelope.connect(this.master!);
      this.voices.add(osc);
      osc.onended = () => { osc.disconnect(); envelope.disconnect(); this.voices.delete(osc); };
      osc.start(start); osc.stop(end + 0.02);
    });
  }
  stop() {
    this.voices.forEach(voice => { try { voice.stop(); } catch {} });
    this.voices.clear();
    this.lastPlayed.clear();
  }
  private applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }
}
export const gameSounds = new SoundEffects();
