// Map obstacles and decoration. Generated per chunk from a seed, so the world is endless, needs no
// storage, and the rules and the renderer always agree on where everything is.

export const CHUNK_SIZE = 480;
const TREE_CELL = 120;
const TREE_JITTER = 40;
const TREE_RADIUS = 24;
const TANK_PART_RADIUS = 30;
const TANK_PART_OFFSET = 24;
const TANK_MARGIN = 80; // keeps a whole tank inside its chunk, so a query only needs nearby chunks
const TANK_TREE_GAP = 105;
const TANK_GAP = 170;
const TANK_CHANCES = [0.62, 0.28];
const FOREST_SCALE = 900;
const TREE_CHANCE_IN_FOREST = 0.82;
const TREE_CHANCE_IN_OPEN = 0.07;
const BUS_START_CLEARING = 760; // no Rocketeer gets a shot in before the player has moved
const BUS_MARGIN = 130; // keeps a whole bus inside its chunk, whichever way it points
const BUS_PART_RADIUS = 36;
const BUS_PART_OFFSETS = [-66, 0, 66];
const BUS_REACH = 102;
const SIGN_CHANCES = [0.5, 0.2];
const SIGN_BUS_GAP = 170;
const SIGN_GAP = 200;
const SIGN_MARGIN = 100; // keeps the whole sign inside its chunk
const SIGN_REACH = 80;
const SIGN_PART_RADIUS = 20;
export const SIGN_POST_OFFSET = 60; // the two posts; the board spans them and the fence of circles joins them
const SIGN_PART_OFFSETS = [-SIGN_POST_OFFSET, -20, 20, SIGN_POST_OFFSET];
// Hills sit near the middle of a chunk, so two neighbouring hills always leave a way between them.
const HILL_MARGIN = 180;
const HILL_MIN_RADIUS = 60;
const HILL_RADIUS_RANGE = 45;
const HILL_LOBE_SPACING = 60;
const HILL_REACH = 165;
const HILL_MAX_LOBES = 3;
const HILL_RANGE_LEVEL = 0.58; // above this the slow noise makes a range of hills
const HILL_CHANCE_IN_RANGE = 0.6;
const HILL_CHANCE_ELSEWHERE = 0.05;
const MAX_CACHED_CHUNKS = 400;
const KEY_SHIFT = 2 ** 21;

// Big characters are treated as slimmer than they look here, or they could not fit between trees.
const ACTOR_CLEARANCE = 14;

function hash(seed, a, b, salt) {
  let h = seed ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** 0 to 1, varying slowly across the map: high values are forest, low values are open ground. */
function forestAmount(seed, x, y) {
  const gx = Math.floor(x / FOREST_SCALE);
  const gy = Math.floor(y / FOREST_SCALE);
  const tx = smooth(x / FOREST_SCALE - gx);
  const ty = smooth(y / FOREST_SCALE - gy);
  const corner = (ox, oy) => hash(seed, gx + ox, gy + oy, 99);
  const top = corner(0, 0) * (1 - tx) + corner(1, 0) * tx;
  const bottom = corner(0, 1) * (1 - tx) + corner(1, 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** clearings: [{ x, y, r }] areas that stay free of obstacles. */
export function createForest(seed, clearings) {
  return { kind: 'forest', seed, clearings, chunks: new Map() };
}

/** Buses and signs block walking but shots fly over them, or nothing could reach the Rocketeer on the roof. Hills stop both. */
export function createWasteland(seed, clearings, busChance) {
  return { kind: 'wasteland', seed, clearings, busChance, chunks: new Map() };
}

function wastelandHill(world, roll, left, top) {
  const { seed, clearings } = world;
  const level = forestAmount(seed, left + CHUNK_SIZE / 2, top + CHUNK_SIZE / 2);
  if (roll(40) >= (level > HILL_RANGE_LEVEL ? HILL_CHANCE_IN_RANGE : HILL_CHANCE_ELSEWHERE)) return null;
  const span = CHUNK_SIZE - HILL_MARGIN * 2;
  const x = left + HILL_MARGIN + roll(41) * span;
  const y = top + HILL_MARGIN + roll(42) * span;
  if (clearings.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + HILL_REACH)) return null;
  const angle = roll(43) * Math.PI;
  const count = 1 + Math.floor(roll(44) * HILL_MAX_LOBES);
  const lobes = Array.from({ length: count }, (_, i) => {
    const offset = (i - (count - 1) / 2) * HILL_LOBE_SPACING;
    return { x: x + Math.cos(angle) * offset, y: y + Math.sin(angle) * offset, r: HILL_MIN_RADIUS + roll(45 + i) * HILL_RADIUS_RANGE };
  });
  return { kind: 'hill', x, y, lobes, variant: roll(49) };
}

function buildWastelandChunk(world, cx, cy) {
  const { seed, clearings, busChance } = world;
  const left = cx * CHUNK_SIZE;
  const top = cy * CHUNK_SIZE;
  const roll = (salt) => hash(seed, cx, cy, salt);
  const items = [];
  const circles = [];
  const hill = wastelandHill(world, roll, left, top);
  if (hill) {
    items.push(hill);
    circles.push(...hill.lobes);
  }
  const isFree = (x, y, reach) => !clearings.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + reach)
    && !hill?.lobes.some((lobe) => Math.hypot(x - lobe.x, y - lobe.y) < lobe.r + reach);

  let bus = null;
  if (roll(1) < busChance) {
    const span = CHUNK_SIZE - BUS_MARGIN * 2;
    const x = left + BUS_MARGIN + roll(2) * span;
    const y = top + BUS_MARGIN + roll(3) * span;
    if (Math.hypot(x, y) >= BUS_START_CLEARING + BUS_REACH && isFree(x, y, BUS_REACH)) {
      const angle = roll(4) * Math.PI;
      bus = { kind: 'bus', id: `${cx}:${cy}`, x, y, angle, variant: roll(5) };
      items.push(bus);
      for (const offset of BUS_PART_OFFSETS) {
        circles.push({ x: x + Math.cos(angle) * offset, y: y + Math.sin(angle) * offset, r: BUS_PART_RADIUS });
      }
    }
  }

  const signs = [];
  SIGN_CHANCES.forEach((chance, i) => {
    if (roll(10 + i * 10) >= chance) return;
    const span = CHUNK_SIZE - SIGN_MARGIN * 2;
    const x = left + SIGN_MARGIN + roll(11 + i * 10) * span;
    const y = top + SIGN_MARGIN + roll(12 + i * 10) * span;
    if (!isFree(x, y, SIGN_REACH) || (bus && Math.hypot(x - bus.x, y - bus.y) < SIGN_BUS_GAP)) return;
    if (signs.some((sign) => Math.hypot(x - sign.x, y - sign.y) < SIGN_GAP)) return;
    const sign = { kind: 'sign', x, y, variant: roll(13 + i * 10) };
    signs.push(sign);
    items.push(sign);
    for (const offset of SIGN_PART_OFFSETS) circles.push({ x: x + offset, y, r: SIGN_PART_RADIUS });
  });
  return { items, circles, cover: hill ? hill.lobes : [] };
}

function buildChunk(world, cx, cy) {
  const { seed, clearings } = world;
  const left = cx * CHUNK_SIZE;
  const top = cy * CHUNK_SIZE;
  const roll = (salt) => hash(seed, cx, cy, salt);
  const isCleared = (x, y, extent) => clearings.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + extent);
  const items = [];
  const circles = [];
  const tanks = [];

  TANK_CHANCES.forEach((chance, i) => {
    if (roll(1 + i * 10) >= chance) return;
    const span = CHUNK_SIZE - TANK_MARGIN * 2;
    const x = left + TANK_MARGIN + roll(2 + i * 10) * span;
    const y = top + TANK_MARGIN + roll(3 + i * 10) * span;
    const reach = TANK_PART_OFFSET + TANK_PART_RADIUS;
    if (isCleared(x, y, reach) || tanks.some((t) => Math.hypot(x - t.x, y - t.y) < TANK_GAP)) return;
    const angle = roll(4 + i * 10) * Math.PI * 2;
    const tank = { kind: 'tank', x, y, angle, variant: roll(5 + i * 10) };
    tanks.push(tank);
    items.push(tank);
    for (const side of [-1, 1]) {
      circles.push({
        x: x + Math.cos(angle) * TANK_PART_OFFSET * side,
        y: y + Math.sin(angle) * TANK_PART_OFFSET * side,
        r: TANK_PART_RADIUS,
      });
    }
  });

  const cells = CHUNK_SIZE / TREE_CELL;
  for (let gx = 0; gx < cells; gx++) {
    for (let gy = 0; gy < cells; gy++) {
      const salt = 100 + gx * cells + gy;
      const x = left + TREE_CELL * (gx + 0.5) + (hash(seed, cx, cy, salt + 200) - 0.5) * TREE_JITTER;
      const y = top + TREE_CELL * (gy + 0.5) + (hash(seed, cx, cy, salt + 400) - 0.5) * TREE_JITTER;
      const chance = forestAmount(seed, x, y) > 0.5 ? TREE_CHANCE_IN_FOREST : TREE_CHANCE_IN_OPEN;
      if (roll(salt) >= chance || isCleared(x, y, TREE_RADIUS)) continue;
      if (tanks.some((t) => Math.hypot(x - t.x, y - t.y) < TANK_TREE_GAP)) continue;
      items.push({ kind: 'tree', x, y, variant: hash(seed, cx, cy, salt + 600) });
      circles.push({ x, y, r: TREE_RADIUS });
    }
  }
  return { items, circles, cover: circles };
}

function chunkAt(world, cx, cy) {
  const key = cx * KEY_SHIFT + cy;
  let chunk = world.chunks.get(key);
  if (!chunk) {
    if (world.chunks.size >= MAX_CACHED_CHUNKS) world.chunks.clear(); // any chunk can be rebuilt exactly
    chunk = (world.kind === 'wasteland' ? buildWastelandChunk : buildChunk)(world, cx, cy);
    world.chunks.set(key, chunk);
  }
  return chunk;
}

/** Calls visit(chunk) for each chunk touching the box; stops early if visit returns true. */
function someChunk(world, minX, minY, maxX, maxY, visit) {
  const x1 = Math.floor(maxX / CHUNK_SIZE);
  const y1 = Math.floor(maxY / CHUNK_SIZE);
  for (let cx = Math.floor(minX / CHUNK_SIZE); cx <= x1; cx++) {
    for (let cy = Math.floor(minY / CHUNK_SIZE); cy <= y1; cy++) {
      if (visit(chunkAt(world, cx, cy))) return true;
    }
  }
  return false;
}

/** Whether something at this point is stopped by cover. Only projectiles ask. */
export function hitsSolid(world, x, y) {
  if (!world) return false;
  return someChunk(world, x, y, x, y, (chunk) =>
    chunk.cover.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 < c.r ** 2));
}

/** Moves an actor out of anything solid and along its edge, so walking at a trunk never stalls. */
export function pushOutOfSolids(world, a, dt) {
  if (!world) return;
  const reach = Math.min(a.r, ACTOR_CLEARANCE);
  someChunk(world, a.x - reach, a.y - reach, a.x + reach, a.y + reach, (chunk) => {
    for (const c of chunk.circles) {
      const dx = a.x - c.x;
      const dy = a.y - c.y;
      const min = c.r + reach;
      const squared = dx * dx + dy * dy;
      if (squared >= min * min) continue;
      const d = Math.sqrt(squared);
      const nx = d ? dx / d : 1;
      const ny = d ? dy / d : 0;
      const along = a.vx * -ny + a.vy * nx;
      const slide = ((along >= 0 ? 1 : -1) * (Math.hypot(a.vx, a.vy) - Math.abs(along)) * dt);
      a.x = c.x + nx * min - ny * slide;
      a.y = c.y + ny * min + nx * slide;
    }
    return false;
  });
}

/** Calls visit(item) for each piece of scenery in the chunks touching the box. */
export function forEachItemIn(world, minX, minY, maxX, maxY, visit) {
  someChunk(world, minX, minY, maxX, maxY, (chunk) => {
    chunk.items.forEach(visit);
    return false;
  });
}
