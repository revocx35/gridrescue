// The public leaderboard, one JSON file in the data volume, and the one-time tokens that tie a score
// to a run the server saw start. The game runs in the browser, so these checks raise the cost of a
// forged score without making one impossible; admins can delete anything that slips through.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAPS } from '../public/js/schema.js';
import { hashToken, randomToken } from './sessions.js';
import { writeAtomic } from './store.js';

export const RUN_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_OPEN_RUNS = 10_000;
const CLOCK_GRACE_SECONDS = 5; // the token request can land just after the game's clock started
const KEEP_PER_RANKING = 50;
export const BOARD_SIZE = 10;

const fastestFirst = (a, b) => a.time - b.time || b.kills - a.kills || a.at - b.at;
const mostKillsFirst = (a, b) => b.kills - a.kills || a.time - b.time || a.at - b.at;
const sorted = (entries, order) => [...entries].sort(order);
const longestFirst = (a, b) => b.time - a.time || b.kills - a.kills || a.at - b.at;
const isEndless = (entry) => entry.mode === 'endless';
const rescueRuns = (entries) => entries.filter((entry) => !isEndless(entry)); // saved before modes existed
const endlessRuns = (entries) => entries.filter(isEndless);
const rescues = (entries) => rescueRuns(entries).filter((entry) => entry.won !== false); // saved before deaths could rank

export class RunTokens {
  constructor(now = Date.now) {
    this.now = now;
    this.runs = new Map();
  }

  /**
   * Written on shutdown and read back once on start, so that a deploy does not cost players the run
   * they are in the middle of. Holds token hashes only.
   */
  save(file) {
    this.#sweep();
    writeAtomic(file, JSON.stringify([...this.runs]));
  }

  load(file, log = console) {
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') log.error({ err: err.message }, 'saved runs were unreadable; ignoring them');
      fs.rmSync(file, { force: true });
      return;
    }
    fs.rmSync(file);
    if (!Array.isArray(stored)) return;
    for (const [key, run] of stored.slice(-MAX_OPEN_RUNS)) {
      if (Number.isFinite(run?.started) && Number.isFinite(run.limits?.minTime) && MAPS.includes(run.map)) this.runs.set(key, run);
    }
    this.#sweep();
  }

  #sweep() {
    const oldest = this.now() - RUN_TTL_MS;
    for (const [key, run] of this.runs) { // insertion order is age order
      if (run.started >= oldest) break;
      this.runs.delete(key);
    }
  }

  /** limits comes from scoreLimits, frozen here so an admin edit mid-run cannot invalidate the run. */
  issue(map, limits, mode = 'rescue') {
    this.#sweep();
    while (this.runs.size >= MAX_OPEN_RUNS) this.runs.delete(this.runs.keys().next().value);
    const token = randomToken();
    this.runs.set(hashToken(token), { map, mode, limits, started: this.now() });
    return token;
  }

  /** One-time lookup: a run can post one score. */
  take(token) {
    if (typeof token !== 'string' || !token) return null;
    this.#sweep();
    const key = hashToken(token);
    const run = this.runs.get(key);
    this.runs.delete(key);
    return run ?? null;
  }

  /** Why this result could not really have happened, or null if it could. A death ranks on kills, so needs one. */
  problemWith(run, { time, kills, won }) {
    if (typeof won !== 'boolean' || !Number.isFinite(time) || time < 0 || !Number.isInteger(kills) || kills < 0) return 'bad_values';
    const elapsed = (this.now() - run.started) / 1000;
    const { minTime, minSpawnGap } = run.limits;
    if (won && run.mode === 'endless') return 'bad_values'; // there is nothing to win
    if (won && time < minTime) return 'too_fast';
    if (!won && kills === 0) return 'no_kills';
    if (time > elapsed + CLOCK_GRACE_SECONDS) return 'longer_than_real_time';
    if (kills > time / minSpawnGap + 1) return 'too_many_kills';
    return null;
  }
}

export class Leaderboard {
  constructor(dataDir, log = console, now = Date.now) {
    this.file = path.join(dataDir, 'leaderboard.json');
    this.log = log;
    this.now = now;
    this.maps = this.#load();
  }

  #load() {
    const empty = () => Object.fromEntries(MAPS.map((map) => [map, []]));
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return empty();
    }
    try {
      const stored = JSON.parse(raw).maps;
      const maps = empty();
      for (const map of MAPS) maps[map] = Array.isArray(stored[map]) ? stored[map] : [];
      return maps;
    } catch (err) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, aside);
      this.log.error({ err: err.message, aside }, 'leaderboard file was unreadable; moved aside, starting empty');
      return empty();
    }
  }

  #save() {
    writeAtomic(this.file, JSON.stringify({ maps: this.maps }));
  }

  /** Adds a score, keeps only the entries that still rank, and reports where this one landed. */
  add(map, { name, time, kills, won, mode = 'rescue' }) {
    const entry = { id: crypto.randomBytes(8).toString('hex'), name, time, kills, won, mode, at: this.now() };
    const entries = [...this.maps[map], entry];
    const top = (list, order) => sorted(list, order).slice(0, KEEP_PER_RANKING);
    const keep = new Set([
      ...top(rescues(entries), fastestFirst),
      ...top(rescueRuns(entries), mostKillsFirst),
      ...top(endlessRuns(entries), mostKillsFirst),
      ...top(endlessRuns(entries), longestFirst),
    ]);
    this.maps[map] = entries.filter((item) => keep.has(item));
    this.#save();
    return { entry };
  }

  /** The public view: the top of each ranking for each map. */
  view() {
    return {
      maps: Object.fromEntries(MAPS.map((map) => {
        const top = (list, order) => sorted(list, order).slice(0, BOARD_SIZE);
        return [map, {
          fastest: top(rescues(this.maps[map]), fastestFirst),
          kills: top(rescueRuns(this.maps[map]), mostKillsFirst),
          endlessKills: top(endlessRuns(this.maps[map]), mostKillsFirst),
          endlessTime: top(endlessRuns(this.maps[map]), longestFirst),
        }];
      })),
    };
  }

  /** The admin's view: every stored entry. */
  all() {
    return { maps: Object.fromEntries(MAPS.map((map) => [map, sorted(this.maps[map], fastestFirst)])) };
  }

  remove(map, id) {
    const before = this.maps[map].length;
    this.maps[map] = this.maps[map].filter((entry) => entry.id !== id);
    if (this.maps[map].length === before) return false;
    this.#save();
    return true;
  }

  clear(map) {
    this.maps[map] = [];
    this.#save();
  }
}
