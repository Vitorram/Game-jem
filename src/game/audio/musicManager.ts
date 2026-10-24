/** Owns one looping track. Changing cue stops the old screen's music immediately. */
export type MusicCue = 'intro' | 'loading' | 'gameplay' | 'gameplaySpeed';
const TRACKS: Record<MusicCue, string> = {
  intro: '/assets/audio/Intro.mp3',
  loading: '/assets/audio/Carregamento.mp3',
  gameplay: '/assets/audio/Gameplay Default.mp3',
  gameplaySpeed: '/assets/audio/Gameplay Speed.mp3',
};

export class MusicManager {
  private current: HTMLAudioElement | null = null;
  private currentCue: MusicCue | null = null;
  private volume = 0.45;
  private muted = false;
  private transitionId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<void> | null = null;
  private fade = 1;

  get cue(): MusicCue | null { return this.currentCue; }
  setVolume(volume: number) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }
  setMuted(muted: boolean) { this.muted = muted; this.applyVolume(); }
  play(cue: MusicCue, fadeMs = 500): Promise<void> {
    if (this.currentCue === cue && this.current) {
      if (this.pending) return this.pending;
      if (!this.current.paused) return Promise.resolve();
    } else {
      this.stop();
      this.current = new Audio(TRACKS[cue]);
      this.current.loop = true;
      this.current.preload = 'auto';
      this.currentCue = cue;
    }
    const next = this.current;
    const transition = ++this.transitionId;
    this.clearFade();
    this.fade = 0;
    this.applyVolume();
    const request = next.play().then(() => {
      if (transition !== this.transitionId) return;
      const duration = Number.isFinite(fadeMs) ? Math.max(0, fadeMs) : 0;
      if (!duration) { this.fade = 1; this.applyVolume(); return; }
      const start = Date.now();
      this.timer = setInterval(() => {
        this.fade = Math.min(1, (Date.now() - start) / duration);
        this.applyVolume();
        if (this.fade === 1) this.clearFade();
      }, 30);
    }).finally(() => {
      if (transition === this.transitionId) this.pending = null;
    });
    this.pending = request;
    return request;
  }
  pause() {
    this.clearFade();
    ++this.transitionId;
    this.pending = null;
    this.current?.pause();
  }
  stop() {
    this.pause();
    if (this.current) this.current.src = '';
    this.current = null;
    this.currentCue = null;
  }
  dispose() { this.stop(); }
  private applyVolume() {
    if (this.current) this.current.volume = this.muted ? 0 : this.volume * this.fade;
  }
  private clearFade() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
export const gameMusic = new MusicManager();
