import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

const sources = [];

class FakeContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  createGain() {
    return { gain: { value: 0, setTargetAtTime() {} }, connect: (next) => next };
  }
  createBufferSource() {
    const source = { connect: (next) => next, start() { this.started = true; }, stop() { this.stopped = true; } };
    sources.push(source);
    return source;
  }
  async decodeAudioData(bytes) {
    return { bytes };
  }
}

let SoundBoard;

before(async () => {
  globalThis.window = { AudioContext: FakeContext };
  globalThis.addEventListener = () => {};
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  ({ SoundBoard } = await import('../public/js/sound.js'));
});

describe('looping sounds', () => {
  const renderer = { inView: () => true };
  const state = {
    player: { x: 0, y: 0 },
    enemies: [{ kind: 'enemy1', x: 50, y: 0 }],
    companions: [],
    hostage: null,
    boss: { alive: true, x: 100, y: 0 },
  };
  let board;

  beforeEach(async () => {
    sources.length = 0;
    board = new SoundBoard();
    board.setMap({ boss: { soundUrls: { theme: '/theme' } }, enemy1: { soundUrls: { idle: '/idle' } } });
    board.unlock();
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    board.update(state, renderer, 'playing');
    assert.equal(sources.length, 2);
  });

  it('keeps the same theme playing through the upgrade menu', () => {
    const theme = board.loops.get('boss:theme').source;
    board.update(state, renderer, 'levelup');
    assert.equal(board.loops.get('boss:theme').source, theme);
    assert.equal(theme.stopped, undefined);
  });

  it('does not restart the theme when the game resumes', () => {
    const theme = board.loops.get('boss:theme').source;
    board.update(state, renderer, 'levelup');
    board.update(state, renderer, 'playing');
    assert.equal(board.loops.get('boss:theme').source, theme);
    assert.equal(sources.length, 3, 'only the idle sound starts again');
  });

  it('stops idle sounds during the upgrade menu', () => {
    board.update(state, renderer, 'levelup');
    assert.equal(board.loops.has('enemy1:idle'), false);
  });

  it('stops everything when paused or finished', () => {
    for (const mode of ['paused', 'ended', 'menu']) {
      board.update(state, renderer, 'playing');
      board.update(state, renderer, mode);
      assert.equal(board.loops.size, 0, mode);
    }
  });
});
