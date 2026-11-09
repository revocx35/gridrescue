// Admin editor. All values are placed with textContent/value, never as HTML.
import { ImageConversionError, imageToPng } from './image-convert.js';
import { formatRunTime } from './leaderboard.js';
import { defaultSprite } from './render.js';
import {
  CHARACTER_FIELDS, GAMEPLAY_FIELDS, MAPS, MAX_MAP_NAME_LENGTH, MAX_NAME_LENGTH, NAMED_ROLES, ORDER_FIELDS, ORDER_LABELS, ROLES, ROLE_FIELDS, ROLE_LABELS,
  SITE_CHOICE_FIELDS, SITE_COLOR_FIELDS, SITE_NUMBER_FIELDS, SITE_TEXT_FIELDS,
} from './schema.js';

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'on') for (const [type, fn] of Object.entries(value)) node.addEventListener(type, fn);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

let csrf = '';
let revision = 0;
let draft = null;
let sprites = {};
let currentMap = MAPS[0];
let dirty = false;
let previewMode = 'desktop';
let renderPreview = () => {};

function setStatus(message, kind = '') {
  $('status').textContent = message;
  $('status').className = `status ${kind}`;
}

function markDirty() {
  dirty = true;
  $('save').disabled = false;
  setStatus('You have unsaved changes.');
  $('brand-title').textContent = draft.site.title;
  renderPreview();
}

function adoptServerState(data, { keepDraft = false } = {}) {
  csrf = data.csrf;
  revision = data.revision;
  sprites = Object.fromEntries(MAPS.map((mapId) => [
    mapId,
    Object.fromEntries(ROLES.map((role) => [role, data.config.maps[mapId].characters[role].sprite])),
  ]));
  if (keepDraft) return;
  draft = structuredClone(data.config);
  for (const mapId of MAPS) for (const role of ROLES) delete draft.maps[mapId].characters[role].sprite;
  dirty = false;
  $('save').disabled = true;
  $('brand-title').textContent = draft.site.title;
  $('user-name').textContent = data.user;
  renderAll();
}

async function api(method, url, body, contentType = 'application/json') {
  const headers = { 'x-csrf-token': csrf };
  if (body !== undefined) headers['content-type'] = contentType;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  const error = new Error(data.error ?? 'failed');
  error.status = response.status;
  error.details = data.details;
  throw error;
}

function explain(error) {
  if (error instanceof ImageConversionError) return error.message;
  if (error.status === 401) return 'Your session has expired. Open this page in a new tab and sign in, then save again.';
  if (error.status === 409) return 'Someone else changed the settings. Reload the page to get the latest version.';
  if (error.status === 413) return 'That image is too large.';
  if (error.status === 422 && error.message === 'invalid_png') return 'The server could not accept that image. Try a different file.';
  if (error.status === 422) return `Please fix: ${(error.details ?? []).join('; ')}`;
  if (error.status === 429) return 'Too many changes in a short time. Wait a minute and try again.';
  return 'Something went wrong. Please try again.';
}

function numberField(spec, value, onChange) {
  const input = el('input', {
    type: 'number', min: spec.min, max: spec.max, step: spec.step, value,
    on: { input: (e) => onChange(e.target.valueAsNumber) },
  });
  return el('label', { class: 'field' }, el('span', { class: 'micro', textContent: spec.label }), input);
}

function choiceField(spec, value, onChange) {
  const select = el(
    'select', { on: { change: (e) => onChange(e.target.value) } },
    ...spec.options.map((option) => el('option', {
      value: option,
      textContent: spec.optionLabels?.[option] ?? option[0].toUpperCase() + option.slice(1),
    })),
  );
  select.value = value;
  return el('label', { class: 'field' }, el('span', { class: 'micro', textContent: spec.label }), select);
}

function toggleField(spec, value, onChange) {
  const input = el('input', { type: 'checkbox', checked: value, on: { change: (e) => onChange(e.target.checked) } });
  return el('label', { class: 'field-check' }, input, el('span', { textContent: spec.label }));
}

function textField(label, max, value, onChange, wide = false) {
  const input = el('input', { type: 'text', maxLength: max, value, on: { input: (e) => onChange(e.target.value) } });
  return el('label', { class: `field${wide ? ' block-wide' : ''}` }, el('span', { class: 'micro', textContent: label }), input);
}

// ---- characters ----

const currentCharacters = () => draft.maps[currentMap].characters;
const roleTitle = (mapId, role) => draft.maps[mapId].characters[role].name ?? ROLE_LABELS[role];

function spriteCanvas(role) {
  const canvas = el('canvas', { class: 'sprite-preview', width: 208, height: 208 });
  const ctx = canvas.getContext('2d');
  const hash = sprites[currentMap][role];
  const place = (source, w, h) => {
    const k = 208 / Math.max(w, h);
    ctx.clearRect(0, 0, 208, 208);
    ctx.drawImage(source, (208 - w * k) / 2, (208 - h * k) / 2, w * k, h * k);
  };
  if (hash) {
    const image = new Image();
    image.onload = () => place(image, image.naturalWidth, image.naturalHeight);
    image.src = `/sprites/${hash}.png`;
  } else {
    place(defaultSprite(currentMap, role), 256, 256);
  }
  return canvas;
}

async function uploadSprite(mapId, role, file) {
  setStatus(`Preparing ${file.name}…`);
  try {
    const png = await imageToPng(file);
    setStatus(`Uploading ${file.name}…`);
    adoptServerState(await api('PUT', `/api/admin/sprites/${mapId}/${role}`, png, 'image/png'), { keepDraft: true });
    renderCharacters();
    setStatus(`Image updated for ${roleTitle(mapId, role)}.${dirty ? ' You still have unsaved changes.' : ''}`, 'good');
  } catch (error) {
    setStatus(explain(error), 'error');
  }
}

async function removeSprite(mapId, role) {
  try {
    adoptServerState(await api('DELETE', `/api/admin/sprites/${mapId}/${role}`), { keepDraft: true });
    renderCharacters();
    setStatus(`Back to the default art for ${roleTitle(mapId, role)}.${dirty ? ' You still have unsaved changes.' : ''}`, 'good');
  } catch (error) {
    setStatus(explain(error), 'error');
  }
}

function characterCard(role) {
  const mapId = currentMap;
  const ch = currentCharacters()[role];
  const hasImage = Boolean(sprites[mapId][role]);
  const fileInput = el('input', {
    // No `accept` filter: with one, phones open the photo picker instead of their file browser.
    type: 'file', class: 'visually-hidden',
    on: { change: (e) => { if (e.target.files[0]) uploadSprite(mapId, role, e.target.files[0]); e.target.value = ''; } },
  });
  fileInput.setAttribute('aria-label', `Upload an image for ${ROLE_LABELS[role]}`);
  const side = el(
    'div', { class: 'char-side' },
    spriteCanvas(role),
    el('span', { class: 'micro sprite-state', textContent: hasImage ? 'Your image' : 'Default art' }),
    el('button', { class: 'btn', type: 'button', textContent: 'Upload file', on: { click: () => fileInput.click() } }),
    fileInput,
  );
  if (hasImage) {
    side.append(el('button', { class: 'btn', type: 'button', textContent: 'Remove', on: { click: () => removeSprite(mapId, role) } }));
  }
  const stats = el('div', { class: 'field-grid' });
  for (const field of ROLE_FIELDS[role]) {
    const spec = CHARACTER_FIELDS[field];
    const update = (value) => {
      ch[field] = value;
      if (field === 'enabled') card.classList.toggle('char-off', !value);
      markDirty();
    };
    if (spec.boolean) stats.append(toggleField(spec, ch[field], update));
    else stats.append(spec.options ? choiceField(spec, ch[field], update) : numberField(spec, ch[field], update));
  }
  const card = el(
    'article', { class: `panel char-card${ch.enabled === false ? ' char-off' : ''}` },
    side,
    el(
      'div', { class: 'char-fields' },
      el('p', { class: 'micro char-role', textContent: ROLE_LABELS[role] }),
      ...(NAMED_ROLES.includes(role) ? [textField('Name', MAX_NAME_LENGTH, ch.name, (value) => { ch.name = value; markDirty(); })] : []),
      stats,
    ),
  );
  return card;
}

function mapBar() {
  const buttons = MAPS.map((mapId) => {
    const button = el('button', {
      class: 'btn', type: 'button', textContent: draft.maps[mapId].name || mapId,
      on: { click: () => { currentMap = mapId; renderCharacters(); } },
    });
    button.setAttribute('aria-pressed', String(mapId === currentMap));
    return button;
  });
  const active = buttons[MAPS.indexOf(currentMap)];
  const map = draft.maps[currentMap];
  return el(
    'div', { class: 'panel map-bar' },
    el('div', { class: 'map-switch' }, el('span', { class: 'micro', textContent: 'Editing map' }), el('div', { class: 'map-switch-buttons' }, ...buttons)),
    textField('Map name', MAX_MAP_NAME_LENGTH, map.name, (value) => {
      map.name = value;
      active.textContent = value || currentMap;
      markDirty();
    }),
  );
}

function renderCharacters() {
  $('tab-characters').replaceChildren(mapBar(), el('div', { class: 'grid-cards' }, ...ROLES.map(characterCard)));
}

// ---- site menu ----

function orderEditor(key, spec, refresh) {
  const list = el('ol', { class: 'order-list' });
  const order = draft.site[key];
  const move = (from, to) => {
    [order[from], order[to]] = [order[to], order[from]];
    markDirty();
    refresh();
  };
  order.forEach((item, index) => {
    const up = el('button', { class: 'btn', type: 'button', textContent: '↑', disabled: index === 0, on: { click: () => move(index, index - 1) } });
    const down = el('button', { class: 'btn', type: 'button', textContent: '↓', disabled: index === order.length - 1, on: { click: () => move(index, index + 1) } });
    up.setAttribute('aria-label', `Move ${ORDER_LABELS[item]} up`);
    down.setAttribute('aria-label', `Move ${ORDER_LABELS[item]} down`);
    list.append(el('li', { class: 'order-item' }, el('span', { textContent: ORDER_LABELS[item] }), up, down));
  });
  return el('div', {}, el('span', { class: 'micro', textContent: spec.label }), list);
}

function drawPreview(host) {
  const s = draft.site;
  const c = s.colors;
  const mobile = previewMode === 'mobile';
  const scale = mobile ? 0.55 : 0.5;
  const gradient = `linear-gradient(100deg, ${c.accent}, ${c.accent2})`;

  const title = el('div', { class: 'mock-title', textContent: s.title || ' ' });
  title.style.fontSize = `${(mobile ? s.titleSizeMobile : s.titleSizeDesktop) * scale}px`;
  title.style.backgroundImage = gradient;
  const titleBlock = el('div', {}, title);
  titleBlock.style.textAlign = s.titleAlign;
  if (s.tagline) {
    const tagline = el('div', { class: 'mock-tagline', textContent: s.tagline });
    tagline.style.color = c.text;
    titleBlock.append(tagline);
  }

  const game = el('div', { class: 'mock-game' });
  game.style.backgroundColor = c.floor;
  game.style.backgroundImage = `linear-gradient(${c.grid} 1px, transparent 1px), linear-gradient(90deg, ${c.grid} 1px, transparent 1px)`;

  const sections = { title: titleBlock, game };
  if (mobile) {
    const size = Math.min(s.joystickSize * 0.45, 76);
    const stick = (fill) => {
      const knob = el('div', { class: 'mock-knob' });
      knob.style.background = fill;
      const joy = el('div', { class: 'mock-joy' }, knob);
      joy.style.width = joy.style.height = `${size}px`;
      return joy;
    };
    const move = stick(gradient);
    const aim = stick(c.accent2);
    sections.joystick = el('div', { class: 'mock-joy-row' }, ...(s.joystickSide === 'left' ? [move, aim] : [aim, move]));
  }

  const order = mobile ? s.mobileOrder : s.desktopOrder;
  const mock = el('div', { class: `mock ${mobile ? 'mock-mobile' : 'mock-desktop'}` }, ...order.map((key) => sections[key]));
  mock.style.backgroundColor = c.background;
  host.replaceChildren(mock);
}

function renderSite() {
  const s = draft.site;
  const texts = el('div', { class: 'block-grid' });
  for (const [key, spec] of Object.entries(SITE_TEXT_FIELDS)) {
    texts.append(textField(spec.label, spec.max, s[key], (value) => { s[key] = value; markDirty(); }, true));
  }

  const appearance = el('div', { class: 'block-grid' });
  for (const [key, spec] of Object.entries(SITE_NUMBER_FIELDS)) {
    appearance.append(numberField(spec, s[key], (value) => { s[key] = value; markDirty(); }));
  }
  for (const [key, spec] of Object.entries(SITE_CHOICE_FIELDS)) {
    appearance.append(choiceField(spec, s[key], (value) => { s[key] = value; markDirty(); }));
  }

  const colors = el('div', { class: 'block-grid' });
  for (const [key, label] of Object.entries(SITE_COLOR_FIELDS)) {
    const input = el('input', { type: 'color', value: s.colors[key], on: { input: (e) => { s.colors[key] = e.target.value; markDirty(); } } });
    colors.append(el('label', { class: 'field' }, el('span', { class: 'micro', textContent: label }), input));
  }

  const orderHost = el('div', { class: 'order-columns' });
  const refreshOrder = () => {
    orderHost.replaceChildren(...Object.entries(ORDER_FIELDS).map(([key, spec]) => orderEditor(key, spec, refreshOrder)));
  };
  refreshOrder();

  const previewHost = el('div');
  const desktopBtn = el('button', { class: 'btn', type: 'button', textContent: 'Desktop' });
  const mobileBtn = el('button', { class: 'btn', type: 'button', textContent: 'Mobile' });
  const select = (mode) => {
    previewMode = mode;
    desktopBtn.setAttribute('aria-pressed', String(mode === 'desktop'));
    mobileBtn.setAttribute('aria-pressed', String(mode === 'mobile'));
    drawPreview(previewHost);
  };
  desktopBtn.addEventListener('click', () => select('desktop'));
  mobileBtn.addEventListener('click', () => select('mobile'));
  renderPreview = () => drawPreview(previewHost);
  select(previewMode);

  $('tab-site').replaceChildren(
    el(
      'div', { class: 'site-layout' },
      el(
        'div', { class: 'site-stack' },
        el('div', { class: 'panel block' }, el('h2', { textContent: 'Text' }), texts),
        el('div', { class: 'panel block' }, el('h2', { textContent: 'Page layout' }), orderHost),
        el('div', { class: 'panel block' }, el('h2', { textContent: 'Sizes and alignment' }), appearance),
        el('div', { class: 'panel block' }, el('h2', { textContent: 'Colours' }), colors),
      ),
      el('aside', { class: 'panel preview-panel' }, el('div', { class: 'preview-switch' }, desktopBtn, mobileBtn), previewHost),
    ),
  );
}

// ---- gameplay ----

function renderGameplay() {
  const grid = el('div', { class: 'block-grid' });
  for (const [key, spec] of Object.entries(GAMEPLAY_FIELDS)) {
    grid.append(numberField(spec, draft.gameplay[key], (value) => { draft.gameplay[key] = value; markDirty(); }));
  }
  $('tab-gameplay').replaceChildren(el('div', { class: 'panel block gameplay-block' }, el('h2', { textContent: 'Rules' }), grid));
}

// ---- leaderboard ----

function renderScores(data) {
  $('tab-leaderboard').replaceChildren(...MAPS.map((mapId) => {
    const entries = data.maps[mapId];
    const clear = el('button', {
      class: 'btn', type: 'button', textContent: 'Clear this map', disabled: !entries.length,
      on: { click: () => clearScores(mapId) },
    });
    const rows = entries.map((entry) => el(
      'li', { class: 'score-row' },
      el('span', { class: 'score-name', textContent: entry.name }),
      el('span', { class: 'score-stat', textContent: `${formatRunTime(entry.time)}${entry.won === false ? ' (died)' : ''}` }),
      el('span', { class: 'score-stat', textContent: `${entry.kills} kills` }),
      el('button', { class: 'btn', type: 'button', textContent: 'Delete', on: { click: () => deleteScore(mapId, entry) } }),
    ));
    return el(
      'div', { class: 'panel block score-block' },
      el('div', { class: 'score-head' }, el('h2', { textContent: draft.maps[mapId].name || mapId }), clear),
      rows.length ? el('ul', { class: 'score-table' }, ...rows) : el('p', { class: 'score-none', textContent: 'No scores yet.' }),
    );
  }));
}

async function changeScores(request, message) {
  try {
    renderScores(await request());
    setStatus(message, 'good');
  } catch (error) {
    setStatus(explain(error), 'error');
  }
}

async function loadScores() {
  try {
    renderScores(await fetch('/api/admin/leaderboard').then((response) => {
      if (!response.ok) throw Object.assign(new Error('failed'), { status: response.status });
      return response.json();
    }));
  } catch (error) {
    setStatus(explain(error), 'error');
  }
}

function deleteScore(mapId, entry) {
  const url = `/api/admin/leaderboard/${mapId}/${entry.id}`;
  return changeScores(() => api('DELETE', url), `Deleted the score by ${entry.name}.`);
}

function clearScores(mapId) {
  if (!confirm(`Delete every score on ${draft.maps[mapId].name}? This cannot be undone.`)) return undefined;
  return changeScores(() => api('DELETE', `/api/admin/leaderboard/${mapId}`), 'Leaderboard cleared.');
}

function renderAll() {
  renderCharacters();
  renderSite();
  renderGameplay();
}

function selectTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(active));
    $(`tab-${tab.dataset.tab}`).hidden = !active;
  }
  if (name === 'leaderboard') loadScores();
}

async function save() {
  $('save').disabled = true;
  try {
    adoptServerState(await api('PUT', '/api/admin/config', { revision, config: draft }));
    setStatus('Saved. Players get the changes the next time they load the game.', 'good');
  } catch (error) {
    $('save').disabled = false;
    setStatus(explain(error), 'error');
  }
}

async function reset() {
  if (!confirm('Restore every name, sprite, colour and rule to its default? Uploaded sprites will be deleted.')) return;
  try {
    adoptServerState(await api('POST', '/api/admin/config/reset', {}));
    setStatus('Defaults restored.', 'good');
  } catch (error) {
    setStatus(explain(error), 'error');
  }
}

async function logout() {
  await api('POST', '/auth/logout', {}).catch(() => {});
  dirty = false;
  location.href = '/admin';
}

async function showSignIn() {
  const params = new URLSearchParams(location.search);
  const errors = {
    denied: 'Sign-in failed or this account is not allowed to edit the game.',
    unavailable: 'Sign-in is not available right now.',
  };
  const message = errors[params.get('error')];
  $('signin-error').textContent = message ?? '';
  $('signin-error').hidden = !message;
  const config = await fetch('/api/config').then((r) => r.json()).catch(() => null);
  const name = config?.site.title ?? 'Admin';
  $('signin-title').textContent = name;
  document.title = `${name} admin`;
  $('signin').hidden = false;
}

async function main() {
  const response = await fetch('/api/admin/session').catch(() => null);
  if (!response || response.status === 401) return showSignIn();
  if (!response.ok) return showSignIn();
  $('app').hidden = false;
  history.replaceState(null, '', '/admin');
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', reset);
  $('logout').addEventListener('click', logout);
  for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  selectTab('characters');
  const data = await response.json();
  document.title = `${data.config.site.title} admin`;
  adoptServerState(data);
}

main();
