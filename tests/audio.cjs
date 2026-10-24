const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
function load(name, globals = {}) {
  const source = stripTypeScriptTypes(fs.readFileSync(`src/game/audio/${name}.ts`, 'utf8'), { mode: 'transform' });
  const exports = [...source.matchAll(/export (?:class|const|function) (\w+)/g)].map(m => m[1]);
  return vm.runInNewContext(source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require("$2");').replace(/export (class|const|function) /g, '$1 ') + `\n;({${exports}})`, globals);
}
const { musicForState, soundForFeedback } = load('audioPolicy');
test('Intro only in menu; loading through story and all tutorial stages; gameplay afterwards', () => {
  assert.equal(musicForState({ screen: 'menu', status: 'ready', preparing: false }), 'intro');
  for (const status of ['ready', 'playing', 'paused']) {
    assert.equal(musicForState({ screen: 'game', status, preparing: true }), 'loading');
  }
  assert.equal(musicForState({ screen: 'game', status: 'playing', preparing: false }), 'gameplay');
  assert.equal(musicForState({ screen: 'game', status: 'finished', preparing: false }), null);
  assert.equal(musicForState({ screen: 'game', status: 'ready', preparing: true, error: true }), null);
});
test('only actual completed tasks reward coins; arrivals and penalties have distinct cues', () => {
  assert.equal(soundForFeedback('order-completed'), 'coin');
  assert.equal(soundForFeedback('order-arrived'), 'notification');
  assert.equal(soundForFeedback('xp-penalty'), 'warning');
  assert.equal(soundForFeedback('risk-resolved'), null);
});
function setup() {
  const audios = [], timers = new Set(); let now = 0, rejectNext = false;
  class Audio {
    constructor(src) { Object.assign(this, { src, paused: true, currentTime: 0, volume: 1, plays: 0 }); audios.push(this); }
    play() { this.plays++; if (rejectNext) { rejectNext = false; return Promise.reject(Error('autoplay')); } this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const { MusicManager } = load('musicManager', { Audio, Date: { now: () => now }, setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn) });
  return { manager: new MusicManager(), audios, timers, reject: () => { rejectNext = true; }, tick: ms => { now += ms; [...timers].forEach(fn => fn()); } };
}
test('rapid cue changes and stop never leave old tracks playing', async () => {
  const { manager, audios, timers } = setup();
  await Promise.all([manager.play('intro'), manager.play('loading'), manager.play('gameplay')]);
  assert.equal(audios.filter(a => !a.paused).length, 1);
  assert.equal(manager.cue, 'gameplay');
  manager.stop(); assert.ok(audios.every(a => a.paused)); assert.equal(timers.size, 0);
});
test('mute and volume stay effective during fade, including invalid volume inputs', async () => {
  const { manager, audios, tick } = setup();
  await manager.play('loading'); manager.setMuted(true); tick(100);
  assert.equal(audios[0].volume, 0);
  manager.setVolume(0.8); tick(100); assert.equal(audios[0].volume, 0);
  manager.setMuted(false); tick(300); assert.equal(audios[0].volume, 0.8);
  manager.setVolume(NaN); assert.equal(audios[0].volume, 0.8); manager.stop();
});
test('same cue is idempotent; pause/resume preserves track position', async () => {
  const { manager, audios } = setup();
  await Promise.all([manager.play('loading', 0), manager.play('loading', 0)]);
  assert.equal(audios.length, 1); assert.equal(audios[0].plays, 1); assert.equal(audios[0].loop, true);
  audios[0].currentTime = 12; manager.pause(); await manager.play('loading', 0);
  assert.equal(audios.length, 1); assert.equal(audios[0].currentTime, 12); manager.stop();
});
test('autoplay rejection can retry without reviving previous track', async () => {
  const { manager, audios, reject } = setup();
  await manager.play('intro', 0); reject();
  await assert.rejects(manager.play('loading', 0));
  assert.ok(audios[0].paused); await manager.play('loading', 0);
  assert.equal(audios.length, 2); assert.equal(audios[1].paused, false); manager.stop();
});
test('sound effects respect volume, mute, horn cooldown and stop', () => {
  let context; const voices = [];
  class AudioContext {
    constructor() { context = this; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createOscillator() { const voice = { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; } }; voices.push(voice); return voice; }
  }
  const { SoundEffects } = load('soundEffects', { AudioContext }); const sounds = new SoundEffects();
  sounds.play('coin'); assert.equal(voices.length, 0);
  sounds.unlock(); sounds.play('horn'); assert.equal(voices.length, 2);
  sounds.play('horn'); assert.equal(voices.length, 2);
  context.currentTime = 8; sounds.play('horn'); assert.equal(voices.length, 4);
  sounds.setMuted(true); sounds.play('coin'); assert.equal(voices.length, 4);
  sounds.setMuted(false); sounds.setVolume(0); sounds.play('coin'); assert.equal(voices.length, 4);
  sounds.setVolume(0.4); sounds.play('coin'); assert.equal(voices.length, 7);
  sounds.stop(); assert.ok(voices.every(v => v.stopped));
});
test('integration follows session end, suppresses tutorial effects and cleans up listeners', () => {
  for (const preparing of [true, false]) {
    const cleanup = [], listeners = new Map(), played = [], sounds = [];
    let view = { snapshot: { status: 'playing' }, feedback: null }, subscriber;
    const document = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const modules = {
      react: { useEffect: fn => cleanup.push(fn()) },
      './musicManager': { gameMusic: { play: cue => { played.push(cue); return Promise.resolve(); }, stop: () => played.push('stop'), pause: () => played.push('pause') } },
      './soundEffects': { gameSounds: { play: cue => sounds.push(cue), unlock() {}, stop() {} } },
      './audioPreferences': { applyAudioPreferences() {}, loadAudioPreferences: () => ({}) },
      './audioPolicy': { musicForState, soundForFeedback },
      '../core/GameState': { suburbanGameState: { snapshot: () => ({ roads: [{ vehicleCount: 4, congestion: 0.9 }] }) } },
      '../session/sessionStore': { sessionStore: { getSnapshot: () => view, subscribe: fn => { subscriber = fn; return () => { subscriber = null; }; } } },
    };
    const { useGameAudio } = load('useGameAudio', { require: id => modules[id], window: document, document });
    useGameAudio({ screen: 'game', status: 'playing', preparing });
    assert.equal(played.at(-1), preparing ? 'loading' : 'gameplay');
    view.feedback = { seq: 1, event: { type: 'order-completed' } }; subscriber(); subscriber();
    assert.equal(sounds.filter(cue => cue === 'coin').length, preparing ? 0 : 1);
    assert.equal(sounds.includes('horn'), !preparing);
    document.hidden = true; listeners.get('visibilitychange')(); assert.equal(played.at(-1), 'pause');
    document.hidden = false; listeners.get('visibilitychange')(); assert.equal(played.at(-1), preparing ? 'loading' : 'gameplay');
    view.snapshot.status = 'finished'; subscriber(); assert.equal(played.at(-1), preparing ? 'loading' : 'stop');
    cleanup.forEach(fn => fn?.()); assert.equal(listeners.size, 0); assert.equal(subscriber, null);
  }
});
