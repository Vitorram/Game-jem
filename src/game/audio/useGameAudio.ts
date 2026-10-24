'use client';
import { useEffect } from 'react';
import { gameMusic } from './musicManager';
import { gameSounds } from './soundEffects';
import { applyAudioPreferences, loadAudioPreferences } from './audioPreferences';
import { musicForState, soundForFeedback, type AudioState } from './audioPolicy';
import { suburbanGameState } from '../core/GameState';
import { sessionStore } from '../session/sessionStore';

export function useGameAudio({ screen, status, preparing, error }: AudioState) {
  useEffect(() => {
    applyAudioPreferences(loadAudioPreferences());
    const sync = () => {
      const finished = screen === 'game' && !preparing && sessionStore.getSnapshot().snapshot?.status === 'finished';
      const cue = musicForState({ screen, status: finished ? 'finished' : status, preparing, error });
      if (!cue) { gameMusic.stop(); gameSounds.stop(); }
      else if (status === 'paused' || document.hidden) { gameMusic.pause(); gameSounds.stop(); }
      else void gameMusic.play(cue).catch(() => {});
    };
    const unlock = () => { gameSounds.unlock(); sync(); };
    // Baseline avoids replaying an old reward when resuming or changing tutorial steps.
    let lastSeq = sessionStore.getSnapshot().feedback?.seq;
    const unsubscribe = screen === 'game' ? sessionStore.subscribe(() => {
      sync();
      const { feedback, snapshot } = sessionStore.getSnapshot();
      if (status === 'playing' && !preparing && !document.hidden && snapshot?.status === 'playing'
        && suburbanGameState.snapshot().roads.some(road => road.vehicleCount >= 3 && road.congestion >= 0.7)) {
        gameSounds.play('horn');
      }
      if (feedback && feedback.seq !== lastSeq) {
        lastSeq = feedback.seq;
        if (status === 'playing' && !preparing && !document.hidden) {
          const cue = soundForFeedback(feedback.event.type);
          if (cue) gameSounds.play(cue);
        }
      }
    }) : () => {};
    sync();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', sync);
    return () => {
      unsubscribe();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [screen, status, preparing, error]);
  useEffect(() => () => { gameMusic.stop(); gameSounds.stop(); }, []);
}
