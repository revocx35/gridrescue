// Server-side admin sessions and pending OIDC logins, kept in memory.
// The browser holds a random token; only its SHA-256 is stored, so a heap dump cannot be replayed.
// A restart signs admins out, which is acceptable for a single-instance admin panel.
import crypto from 'node:crypto';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const PENDING_LOGIN_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 64;
const MAX_PENDING = 512;

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = crypto.createHash('sha256').update(a).digest();
  const right = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(left, right);
}

function evictOldest(map, limit) {
  while (map.size >= limit) map.delete(map.keys().next().value);
}

export class Sessions {
  constructor(now = Date.now) {
    this.now = now;
    this.sessions = new Map();
    this.pending = new Map();
  }

  #sweep() {
    const t = this.now();
    for (const [key, s] of this.sessions) {
      if (t - s.lastSeen > SESSION_IDLE_MS || t - s.created > SESSION_ABSOLUTE_MS) this.sessions.delete(key);
    }
    for (const [key, p] of this.pending) {
      if (t - p.created > PENDING_LOGIN_MS) this.pending.delete(key);
    }
  }

  create(user) {
    this.#sweep();
    evictOldest(this.sessions, MAX_SESSIONS);
    const token = randomToken();
    const t = this.now();
    this.sessions.set(hashToken(token), { user, csrf: randomToken(), created: t, lastSeen: t });
    return token;
  }

  /** Returns the live session and refreshes its idle timer, or null. */
  get(token) {
    if (typeof token !== 'string' || !token) return null;
    this.#sweep();
    const session = this.sessions.get(hashToken(token));
    if (!session) return null;
    session.lastSeen = this.now();
    return session;
  }

  destroy(token) {
    if (typeof token === 'string') this.sessions.delete(hashToken(token));
  }

  /** Remembers an in-flight login. `browser` is the cookie value that ties it to this browser. */
  addPending(state, data) {
    this.#sweep();
    evictOldest(this.pending, MAX_PENDING);
    this.pending.set(hashToken(state), { ...data, created: this.now() });
  }

  /** One-time lookup: a state value can be redeemed once. */
  takePending(state) {
    if (typeof state !== 'string' || !state) return null;
    this.#sweep();
    const key = hashToken(state);
    const entry = this.pending.get(key);
    this.pending.delete(key);
    return entry ?? null;
  }
}
