// The forest map's obstacles. Generated per chunk from a seed, so the world is endless, needs no
// storage, and the rules and the renderer always agree on where everything is.

const CHUNK_SIZE = 480;
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
  return { seed, clearings, chunks: new Map() };
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
  return { items, circles };
}

function chunkAt(world, cx, cy) {
  const key = cx * KEY_SHIFT + cy;
  let chunk = world.chunks.get(key);
  if (!chunk) {
    if (world.chunks.size >= MAX_CACHED_CHUNKS) world.chunks.clear(); // any chunk can be rebuilt exactly
    chunk = buildChunk(world, cx, cy);
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

export function hitsSolid(world, x, y) {
  if (!world) return false;
  return someChunk(world, x, y, x, y, (chunk) =>
    chunk.circles.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 < c.r ** 2));
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

/** Calls visit(item) for each tree and tank in the box. */
export function forEachItemIn(world, minX, minY, maxX, maxY, visit) {
  someChunk(world, minX, minY, maxX, maxY, (chunk) => {
    chunk.items.forEach(visit);
    return false;
  });
}
