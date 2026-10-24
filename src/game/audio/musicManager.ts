/** Independent soundtrack controller. No scene or screen imports. */
export type MusicCue = "intro" | "loading" | "gameplay" | "gameplaySpeed";
const TRACKS: Record<MusicCue, string> = {
  intro: "/assets/audio/Intro.mp3",
  loading: "/assets/audio/Carregamento.mp3",
  gameplay: "/assets/audio/Gameplay Default.mp3",
  gameplaySpeed: "/assets/audio/Gameplay Speed.mp3",
};

export class MusicManager {
  private current: HTMLAudioElement | null = null;
  private currentCue: MusicCue | null = null;
  private volume = 0.45;
  private muted = false;
  private transitionId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  get cue(): MusicCue | null { return this.currentCue; }
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.current) this.current.volume = this.muted ? 0 : this.volume;
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.current) this.current.volume = muted ? 0 : this.volume;
  }
  async play(cue: MusicCue, fadeMs = 500): Promise<void> {
    if (this.currentCue === cue && this.current && !this.current.paused) return;
    this.clearFade();
    const transition = ++this.transitionId;
    const previous = this.current;
    const next = new Audio(TRACKS[cue]);
    next.loop = true;
    next.preload = "auto";
    next.volume = 0;
    this.current = next;
    this.currentCue = cue;
    try {
      await next.play();
    } catch (error) {
      if (transition === this.transitionId) {
        this.current = previous;
        this.currentCue = null;
      }
      next.pause();
      throw error; // Browser autoplay policy: call after a user gesture.
    }
    if (transition !== this.transitionId) { next.pause(); return; }
    const duration = Math.max(0, fadeMs);
    if (duration === 0) {
      next.volume = this.muted ? 0 : this.volume;
      previous?.pause();
      return;
    }
    const target = this.muted ? 0 : this.volume;
    const start = Date.now();
    const previousVolume = previous?.volume ?? 0;
    this.timer = setInterval(() => {
      if (transition !== this.transitionId) return;
      const t = Math.min(1, (Date.now() - start) / duration);
      next.volume = Math.max(0, Math.min(1, target * t));
      if (previous) previous.volume = Math.max(0, Math.min(1, previousVolume * (1 - t)));
      if (t >= 1) {
        this.clearFade();
        previous?.pause();
        if (previous) previous.src = "";
      }
    }, 30);
  }
  stop() {
    this.clearFade();
    ++this.transitionId;
    this.current?.pause();
    if (this.current) this.current.src = "";
    this.current = null;
    this.currentCue = null;
  }
  dispose() { this.stop(); }
  private clearFade() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const gameMusic = new MusicManager();
