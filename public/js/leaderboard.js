// Talks to the leaderboard API and draws its tables. Player names only ever go through textContent.

const postJson = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Registers a run with the server. Resolves to its token, or null if the server cannot be reached. */
export async function startRun(map) {
  try {
    const response = await postJson('/api/runs', { map });
    return response.ok ? (await response.json()).token : null;
  } catch {
    return null;
  }
}

/** Resolves to { ok: true, entry } or { ok: false, error }. */
export async function postScore(score) {
  try {
    const response = await postJson('/api/leaderboard', score);
    const data = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, entry: data.entry } : { ok: false, error: data.error ?? 'failed' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function fetchBoard() {
  const response = await fetch('/api/leaderboard', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export function formatRunTime(seconds) {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

function ranking(title, entries, valueOf, highlightId, emptyText) {
  const heading = document.createElement('h3');
  heading.className = 'micro';
  heading.textContent = title;
  const list = document.createElement('ol');
  list.className = 'board-list';
  for (const entry of entries) {
    const name = document.createElement('span');
    name.className = 'board-name';
    name.textContent = entry.name;
    name.title = entry.name;
    const value = document.createElement('b');
    value.textContent = valueOf(entry);
    const row = document.createElement('li');
    if (entry.id === highlightId) row.className = 'board-mine';
    row.append(name, value);
    list.append(row);
  }
  const section = document.createElement('section');
  section.append(heading);
  if (entries.length) {
    section.append(list);
  } else {
    const none = document.createElement('p');
    none.className = 'board-empty';
    none.textContent = emptyText;
    section.append(none);
  }
  return section;
}

export function renderBoard(host, board, highlightId) {
  host.replaceChildren(
    ranking('Fastest rescue', board.fastest, (entry) => formatRunTime(entry.time), highlightId, 'No rescues yet'),
    ranking('Most kills', board.kills, (entry) => String(entry.kills), highlightId, 'No scores yet'),
  );
}
