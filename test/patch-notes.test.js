import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { PATCH_NOTES } from '../public/js/patch-notes.js';

const parts = (version) => version.split('.').map(Number);
const isNewer = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  const i = x.findIndex((part, index) => part !== y[index]);
  return i !== -1 && x[i] > y[i];
};

describe('patch notes', () => {
  it('have an entry for the current version', () => {
    const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(PATCH_NOTES[0].version, version);
  });

  it('go from newest to oldest, each version once', () => {
    for (let i = 1; i < PATCH_NOTES.length; i++) {
      assert.ok(isNewer(PATCH_NOTES[i - 1].version, PATCH_NOTES[i].version), PATCH_NOTES[i].version);
      assert.ok(PATCH_NOTES[i - 1].date >= PATCH_NOTES[i].date, PATCH_NOTES[i].version);
    }
  });

  it('say what changed in every version', () => {
    for (const { version, date, changes } of PATCH_NOTES) {
      assert.match(version, /^\d+\.\d+\.\d+$/);
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(changes.length > 0, version);
      for (const change of changes) assert.ok(change.trim().length > 0, version);
    }
  });
});
