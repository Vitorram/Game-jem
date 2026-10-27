import type { MusicCue } from './musicManager';
export type AudioState = {
  screen: 'menu' | 'game';
  status: 'ready' | 'playing' | 'paused' | 'finished';
  preparing: boolean;
  error?: boolean;
};
/** Audio follows existing game states; it never decides victory or defeat. */
export function musicForState(state: AudioState): MusicCue | null {
  if (state.error || state.status === 'finished') return null;
  if (state.screen === 'menu') return 'intro';
  return state.preparing || state.status === 'ready' ? 'loading' : 'gameplay';
}
export function soundForFeedback(type: string): 'coin' | 'notification' | 'warning' | null {
  if (type === 'order-completed') return 'coin';
  if (type === 'order-arrived') return 'notification';
  if (type === 'score-warning') return 'warning';
  return null;
}
