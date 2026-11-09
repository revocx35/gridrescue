// Draws the simulation state on a canvas. Holds no game rules.
import { forEachItemIn } from './scenery.js';
import { CELL_SIZE } from './sim.js';

const ART_SIZE = 256;
const TAU = Math.PI * 2;

function tile(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function disc(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function poly(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/** A strike jet from above, nose to the right. */
function jetArt(body, shade, canopy) {
  return (c) => {
    c.fillStyle = shade; poly(c, [[60, 44], [34, 4], [22, 4], [36, 44]]); poly(c, [[60, 56], [34, 96], [22, 96], [36, 56]]);
    poly(c, [[24, 44], [6, 26], [0, 26], [10, 44]]); poly(c, [[24, 56], [6, 74], [0, 74], [10, 56]]);
    c.fillStyle = body; poly(c, [[6, 42], [76, 38], [99, 50], [76, 62], [6, 58]]);
    poly(c, [[78, 42], [68, 26], [62, 26], [66, 42]]); poly(c, [[78, 58], [68, 74], [62, 74], [66, 58]]);
    c.fillStyle = canopy; tile(c, 66, 44, 20, 12, 5);
    c.fillStyle = '#ff9a3d'; tile(c, 0, 44, 8, 5, 2); tile(c, 0, 51, 8, 5, 2);
  };
}

/** A guided missile from above, nose to the right. */
function missileArt(body, tip) {
  return (c) => {
    c.fillStyle = tip; poly(c, [[76, 40], [99, 50], [76, 60]]);
    poly(c, [[26, 40], [8, 16], [2, 16], [12, 40]]); poly(c, [[26, 60], [8, 84], [2, 84], [12, 60]]);
    c.fillStyle = body; tile(c, 8, 40, 72, 20, 4);
    c.fillStyle = tip; tile(c, 50, 40, 6, 20, 1);
  };
}

// Built-in art, drawn in a 100x100 box. Used until the admin uploads a PNG for the role.
const ART = {
  player(c) {
    c.fillStyle = '#187a6c'; tile(c, 20, 44, 14, 34, 7); tile(c, 66, 44, 14, 34, 7);
    c.fillStyle = '#39e0c2'; tile(c, 28, 40, 44, 48, 14);
    c.fillStyle = '#0f4b43'; tile(c, 38, 56, 24, 8, 4);
    c.fillStyle = '#f2c9a0'; disc(c, 50, 27, 21);
    c.fillStyle = '#123038'; tile(c, 32, 19, 36, 13, 6);
    c.fillStyle = '#9ffff0'; tile(c, 52, 22, 12, 6, 3);
  },
  companion(c) {
    c.fillStyle = '#2d7a43'; tile(c, 6, 40, 26, 12, 6); tile(c, 68, 40, 26, 12, 6);
    c.fillStyle = '#b7f7c4'; tile(c, 2, 34, 34, 5, 2); tile(c, 64, 34, 34, 5, 2);
    c.fillStyle = '#7be08a'; disc(c, 50, 50, 28);
    c.fillStyle = '#123022'; disc(c, 50, 48, 16);
    c.fillStyle = '#d6ffe0'; disc(c, 55, 45, 7);
    c.fillStyle = '#2d7a43'; tile(c, 40, 74, 20, 12, 5);
  },
  hostage(c) {
    c.fillStyle = '#b98a4a'; tile(c, 30, 44, 40, 46, 12);
    c.strokeStyle = '#4a2f12'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(30, 50); c.lineTo(70, 82); c.moveTo(70, 50); c.lineTo(30, 82); c.stroke();
    c.fillStyle = '#ffd9a8'; disc(c, 50, 28, 20);
    c.fillStyle = '#3b2612'; disc(c, 43, 27, 3.4); disc(c, 57, 27, 3.4);
    c.strokeStyle = '#3b2612'; c.lineWidth = 3;
    c.beginPath(); c.arc(50, 42, 7, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
  },
  enemy1(c) {
    c.fillStyle = '#6e1420'; poly(c, [[16, 30], [8, 6], [34, 20]]); poly(c, [[84, 30], [92, 6], [66, 20]]);
    c.fillStyle = '#c92a3a'; tile(c, 12, 18, 76, 72, 20);
    c.fillStyle = '#7d1421'; tile(c, 22, 62, 56, 22, 8);
    c.fillStyle = '#ffe6e0'; poly(c, [[28, 62], [36, 76], [44, 62]]); poly(c, [[56, 62], [64, 76], [72, 62]]);
    c.fillStyle = '#ffd34d'; poly(c, [[24, 36], [44, 44], [26, 50]]); poly(c, [[76, 36], [56, 44], [74, 50]]);
  },
  enemy2(c) {
    c.fillStyle = '#d13f9a';
    const points = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const r = i % 2 ? 30 : 47;
      points.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
    }
    poly(c, points);
    c.fillStyle = '#2b0a22'; disc(c, 50, 50, 20);
    c.fillStyle = '#ffe1f4'; disc(c, 50, 50, 11);
    c.fillStyle = '#2b0a22'; disc(c, 53, 50, 5);
  },
  boss(c) {
    c.fillStyle = '#3a0d17'; tile(c, 2, 36, 26, 40, 11); tile(c, 72, 36, 26, 40, 11);
    c.fillStyle = '#541322'; tile(c, 16, 26, 68, 68, 18);
    c.fillStyle = '#ffc247'; poly(c, [[26, 30], [24, 4], [38, 18], [50, 2], [62, 18], [76, 4], [74, 30]]);
    c.fillStyle = '#e8384f'; disc(c, 50, 15, 4.5);
    c.fillStyle = '#17040a'; tile(c, 26, 38, 48, 26, 9);
    c.fillStyle = '#ff5b6e'; poly(c, [[31, 44], [46, 52], [32, 58]]); poly(c, [[69, 44], [54, 52], [68, 58]]);
    c.fillStyle = '#ffc247'; tile(c, 30, 72, 40, 7, 3);
    c.fillStyle = '#17040a'; tile(c, 36, 73.5, 5, 4, 1); tile(c, 47.5, 73.5, 5, 4, 1); tile(c, 59, 73.5, 5, 4, 1);
  },
  enemy5(c) {
    c.fillStyle = '#2c1a52'; poly(c, [[50, 2], [92, 24], [98, 70], [50, 98], [2, 70], [8, 24]]);
    c.fillStyle = '#5b35a8'; poly(c, [[50, 14], [82, 31], [86, 64], [50, 86], [14, 64], [18, 31]]);
    c.fillStyle = '#12082a'; disc(c, 50, 48, 24);
    c.fillStyle = '#c084ff'; disc(c, 50, 48, 16);
    c.fillStyle = '#fff2ff'; disc(c, 50, 48, 7);
  },
  ball(c) {
    c.fillStyle = '#3b1a78'; disc(c, 50, 50, 48);
    c.fillStyle = '#8a4dff'; disc(c, 50, 50, 39);
    c.fillStyle = '#d3b4ff'; disc(c, 41, 40, 18);
    c.fillStyle = '#fff'; disc(c, 36, 34, 7);
  },
  jet: jetArt('#7f8fa3', '#566579', '#16283a'),
  missile: missileArt('#d7dde6', '#ff5b6e'),
};

// The forest map's own cast.
const FOREST_ART = {
  player(c) {
    c.fillStyle = '#3f5a2a'; tile(c, 22, 44, 12, 34, 6); tile(c, 66, 44, 12, 34, 6);
    c.fillStyle = '#6f8f3e'; tile(c, 28, 40, 44, 48, 12);
    c.fillStyle = '#8a5a2b'; poly(c, [[30, 46], [38, 42], [70, 80], [62, 86]]);
    c.fillStyle = '#e6bd92'; disc(c, 50, 28, 19);
    c.fillStyle = '#4b3a1d'; tile(c, 20, 19, 60, 7, 3); tile(c, 33, 7, 34, 15, 6);
  },
  companion(c) {
    c.fillStyle = '#6b4a2a'; poly(c, [[24, 34], [18, 6], [42, 24]]); poly(c, [[76, 34], [82, 6], [58, 24]]);
    c.fillStyle = '#a97a48'; disc(c, 50, 48, 32);
    c.fillStyle = '#e8d3b3'; tile(c, 34, 52, 32, 30, 14);
    c.fillStyle = '#1f130a'; disc(c, 38, 42, 5); disc(c, 62, 42, 5); tile(c, 43, 54, 14, 10, 5);
  },
  hostage(c) {
    c.fillStyle = '#d9772b'; tile(c, 28, 44, 44, 46, 12);
    c.strokeStyle = '#3a2410'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(28, 62); c.lineTo(72, 62); c.moveTo(28, 76); c.lineTo(72, 76); c.stroke();
    c.fillStyle = '#ffd9a8'; disc(c, 50, 27, 19);
    c.fillStyle = '#5b6470'; tile(c, 29, 9, 42, 15, 7);
    c.fillStyle = '#9fd8f2'; tile(c, 35, 19, 30, 9, 4);
  },
  enemy1(c) {
    c.fillStyle = '#2b2f24'; tile(c, 4, 26, 16, 12, 5); tile(c, 80, 26, 16, 12, 5); tile(c, 2, 56, 18, 12, 5); tile(c, 80, 56, 18, 12, 5);
    c.fillStyle = '#5b6650'; disc(c, 50, 54, 39);
    c.fillStyle = '#3b4434'; poly(c, [[50, 16], [58, 92], [42, 92]]);
    c.fillStyle = '#2b2f24'; tile(c, 28, 8, 44, 24, 10);
    c.fillStyle = '#ffb347'; disc(c, 40, 19, 5); disc(c, 60, 19, 5);
  },
  enemy2(c) {
    c.fillStyle = '#6d6a3a'; poly(c, [[50, 4], [62, 30], [94, 24], [74, 52], [88, 86], [50, 72], [12, 86], [26, 52], [6, 24], [38, 30]]);
    c.fillStyle = '#23200f'; disc(c, 50, 48, 17);
    c.fillStyle = '#d7ff5e'; disc(c, 43, 46, 5); disc(c, 57, 46, 5);
  },
  boss(c) {
    c.fillStyle = '#2d3324'; tile(c, 2, 14, 22, 78, 8); tile(c, 76, 14, 22, 78, 8);
    c.fillStyle = '#5a6444'; tile(c, 18, 24, 64, 64, 10);
    c.fillStyle = '#3d4530'; disc(c, 50, 52, 22);
    c.fillStyle = '#2d3324'; tile(c, 44, 0, 12, 44, 3);
    c.fillStyle = '#ff5b3d'; disc(c, 42, 52, 4); disc(c, 58, 52, 4);
  },
  enemy5(c) {
    c.fillStyle = '#3a2413'; tile(c, 4, 40, 20, 54, 9); tile(c, 76, 40, 20, 54, 9);
    c.fillStyle = '#6e4522'; tile(c, 16, 16, 68, 76, 18);
    c.fillStyle = '#3f6d2a'; disc(c, 28, 16, 15); disc(c, 50, 11, 18); disc(c, 72, 16, 15);
    c.fillStyle = '#1b0f06'; tile(c, 28, 40, 44, 22, 9);
    c.fillStyle = '#ff8a3d'; disc(c, 39, 51, 6); disc(c, 61, 51, 6);
  },
  ball(c) {
    c.fillStyle = '#3a3b39'; poly(c, [[30, 4], [72, 6], [97, 36], [92, 72], [64, 97], [26, 92], [3, 64], [6, 26]]);
    c.fillStyle = '#6e706a'; poly(c, [[34, 14], [68, 16], [85, 40], [78, 68], [58, 84], [30, 80], [14, 58], [17, 32]]);
    c.fillStyle = '#90928a'; disc(c, 40, 36, 14);
    c.strokeStyle = '#2c2d2b'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(60, 30); c.lineTo(52, 54); c.lineTo(68, 70); c.stroke();
  },
  jet: jetArt('#6b7a4e', '#4a5636', '#1c2a1a'),
  missile: missileArt('#c9c4a6', '#d9772b'),
};

export function defaultSprite(mapId, role) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ART_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.scale(ART_SIZE / 100, ART_SIZE / 100);
  (mapId === 'forest' ? FOREST_ART : ART)[role](ctx);
  return canvas;
}

// Scenery is drawn once to offscreen canvases, then stamped: far cheaper per frame on phones.
const SCENERY_ART_SCALE = 2;

function stamp(size, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * SCENERY_ART_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCENERY_ART_SCALE, SCENERY_ART_SCALE);
  ctx.translate(size / 2, size / 2);
  paint(ctx);
  return { canvas, size };
}

function treeStamp([dark, mid, light]) {
  return stamp(112, (c) => {
    c.fillStyle = 'rgba(0,0,0,0.3)'; disc(c, 5, 8, 44);
    c.fillStyle = dark; disc(c, 0, 0, 42); disc(c, -22, 14, 22); disc(c, 24, 10, 24); disc(c, 4, -26, 24);
    c.fillStyle = mid; disc(c, -6, -5, 31); disc(c, 16, 6, 18);
    c.fillStyle = light; disc(c, -12, -12, 15); disc(c, 8, -6, 8);
  });
}

function tankStamp([hull, shade]) {
  return stamp(190, (c) => {
    c.fillStyle = 'rgba(8,8,6,0.55)'; disc(c, 0, 0, 86);
    c.fillStyle = '#1b1a16'; tile(c, -66, -48, 132, 20, 6); tile(c, -66, 28, 132, 20, 6);
    c.fillStyle = hull; poly(c, [[-62, -32], [50, -34], [66, -14], [58, 33], [-20, 30], [-34, 36], [-64, 30]]);
    c.fillStyle = shade; poly(c, [[-40, -16], [26, -22], [46, 4], [12, 24], [-42, 18]]);
    c.fillStyle = '#0c0b09'; poly(c, [[-8, -14], [14, -8], [18, 8], [2, 16], [-16, 8]]); // the hole the shell left
    c.fillStyle = hull; poly(c, [[20, -30], [84, -52], [88, -45], [26, -18]]); // bent barrel
    c.fillStyle = '#c4551f'; disc(c, -48, -20, 4); disc(c, 40, 22, 5);
    c.fillStyle = '#ffb347'; disc(c, 3, 3, 3.5);
  });
}

let sceneryStamps = null;

function getSceneryStamps() {
  sceneryStamps ??= {
    tree: [['#1a3a1e', '#27562a', '#3a7337'], ['#1c3320', '#2e5a2c', '#4a7c35'], ['#2a3a16', '#46611f', '#6b8430']].map(treeStamp),
    tank: [['#4a5236', '#333a26'], ['#3b3d33', '#292b24']].map(tankStamp),
  };
  return sceneryStamps;
}

function silhouette(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function makeSprite(source, width, height) {
  const longest = Math.max(width, height);
  return {
    source,
    aspect: width / height,
    flash: silhouette(source, Math.round((width / longest) * 128) || 1, Math.round((height / longest) * 128) || 1),
  };
}

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Loads a map's sprites, falling back to the built-in art when a PNG is missing or broken. */
export async function loadSprites(mapId, characters) {
  const sprites = {};
  await Promise.all(
    Object.entries(characters).map(async ([role, ch]) => {
      const image = ch.spriteUrl ? await loadImage(ch.spriteUrl) : null;
      sprites[role] = image
        ? makeSprite(image, image.naturalWidth, image.naturalHeight)
        : makeSprite(defaultSprite(mapId, role), ART_SIZE, ART_SIZE);
    }),
  );
  return sprites;
}

export function drawSpriteInBox(ctx, sprite, x, y, box) {
  const w = sprite.aspect >= 1 ? box : box * sprite.aspect;
  const h = sprite.aspect >= 1 ? box / sprite.aspect : box;
  ctx.drawImage(sprite.source, x + (box - w) / 2, y + (box - h) / 2, w, h);
}

function cellNoise(cx, cy) {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

export class Renderer {
  constructor(canvas, config, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;
    this.sprites = sprites;
    this.width = 1;
    this.height = 1;
    this.scale = 1;
    this.view = { halfW: 500, halfH: 350 };
    this.camera = null;
    this.particles = [];
    this.rings = [];
    this.shake = 0;
    this.clock = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, box.width);
    this.height = Math.max(1, box.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.dpr = dpr;
    // Keep roughly the same amount of world in view on small and large screens.
    this.scale = Math.min(1.5, Math.max(0.72, Math.min(this.width, this.height) / 640));
    this.view.halfW = this.width / 2 / this.scale;
    this.view.halfH = this.height / 2 / this.scale;
  }

  /** Switches to another map's settings and art. */
  setMap(config, sprites) {
    this.config = config;
    this.sprites = sprites;
  }

  /** Where a world position appears, in CSS pixels from the canvas's top-left corner. */
  toScreen(x, y) {
    const cam = this.camera ?? { x, y };
    return { x: this.width / 2 + (x - cam.x) * this.scale, y: this.height / 2 + (y - cam.y) * this.scale };
  }

  burst(x, y, color, count, power = 240) {
    for (let i = 0; i < count && this.particles.length < 260; i++) {
      const a = Math.random() * TAU;
      const v = power * (0.25 + Math.random() * 0.75);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ttl: 0.45, total: 0.45, color });
    }
  }

  handleEvent(event) {
    const { accent, accent2 } = this.config.site.colors;
    if (event.type === 'kill') {
      const look = { enemy1: ['#ff6b78', 26, 7], enemy2: ['#f07ac0', 14, 2], enemy5: ['#c084ff', 60, 12], jet: ['#ffb347', 70, 14] }[event.kind];
      this.burst(event.x, event.y, look[0], look[1]);
      this.shake = Math.max(this.shake, look[2]);
    } else if (event.type === 'missileDown') {
      this.burst(event.x, event.y, '#ffb347', 22, 300);
      this.shake = Math.max(this.shake, 4);
    } else if (event.type === 'impact') {
      this.burst(event.x, event.y, '#c9b98a', 4, 120);
    } else if (event.type === 'hurt') {
      this.shake = Math.max(this.shake, 8);
    } else if (event.type === 'bossDead') {
      this.burst(event.x, event.y, accent2, 120, 520);
      this.rings.push({ x: event.x, y: event.y, ttl: 1, total: 1, color: accent2, reach: 620 });
      this.shake = 18;
    } else if (event.type === 'companion') {
      this.rings.push({ x: event.x, y: event.y, ttl: 0.7, total: 0.7, color: accent, reach: 120 });
    }
  }

  #drawForestFloor(ctx, s, cam, cells) {
    const { halfW, halfH } = this.view;
    ctx.fillStyle = '#16211a';
    ctx.fillRect(cam.x - halfW - 2, cam.y - halfH - 2, halfW * 2 + 4, halfH * 2 + 4);
    this.#forEachCell(cells, (cx, cy, n) => {
      if (n < 0.5) return;
      ctx.fillStyle = n > 0.8 ? '#2a2a1b' : '#1f3020';
      ctx.beginPath();
      ctx.ellipse((cx + 0.5) * CELL_SIZE, (cy + 0.5) * CELL_SIZE, 58 + n * 40, 40 + n * 28, n * 6, 0, TAU);
      ctx.fill();
    });
    this.#forEachCell(cells, (cx, cy, n) => {
      if (n > 0.16) return;
      ctx.fillStyle = '#3c5a2c';
      const x = cx * CELL_SIZE + 12 + n * 300;
      const y = cy * CELL_SIZE + 60 - n * 200;
      ctx.fillRect(x, y, 3, 9);
      ctx.fillRect(x + 7, y + 2, 3, 7);
      ctx.fillRect(x - 6, y + 3, 3, 6);
    });
    this.#drawHintCells(ctx, s, cells);
  }

  #forEachCell({ x0, x1, y0, y1 }, visit) {
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) visit(cx, cy, cellNoise(cx, cy));
    }
  }

  #drawHintCells(ctx, s, cells) {
    const hint = s.hint;
    if (!hint) return;
    const alpha = Math.sin(Math.min(1, hint.ttl / hint.total) * Math.PI);
    ctx.fillStyle = this.config.site.colors.accent2;
    this.#forEachCell(cells, (cx, cy, n) => {
      const left = cx * CELL_SIZE;
      const top = cy * CELL_SIZE;
      const mx = left + CELL_SIZE / 2 - s.player.x;
      const my = top + CELL_SIZE / 2 - s.player.y;
      if (Math.hypot(mx, my) <= 30 || angleDelta(Math.atan2(my, mx), hint.angle) >= hint.spread / 2) return;
      ctx.globalAlpha = alpha * (0.14 + 0.3 * (n * 0.5 + 0.5));
      ctx.fillRect(left + 1, top + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    });
    ctx.globalAlpha = 1;
  }

  #drawScenery(ctx, s, cam) {
    if (!s.world) return;
    const { halfW, halfH } = this.view;
    const stamps = getSceneryStamps();
    const margin = 120;
    const smoke = [];
    forEachItemIn(s.world, cam.x - halfW - margin, cam.y - halfH - margin, cam.x + halfW + margin, cam.y + halfH + margin, (item) => {
      const set = stamps[item.kind];
      const art = set[Math.floor(item.variant * set.length)];
      ctx.save();
      ctx.translate(item.x, item.y);
      if (item.kind === 'tank') {
        ctx.rotate(item.angle);
        smoke.push(item);
      }
      ctx.drawImage(art.canvas, -art.size / 2, -art.size / 2, art.size, art.size);
      ctx.restore();
    });
    if (this.reducedMotion) return;
    ctx.fillStyle = '#8a8a80';
    for (const tank of smoke) {
      for (let i = 0; i < 3; i++) {
        const age = (this.clock * 0.35 + tank.variant * 7 + i / 3) % 1;
        ctx.globalAlpha = (1 - age) * 0.22;
        disc(ctx, tank.x + Math.sin(age * 6 + i) * 12, tank.y - age * 90, 8 + age * 20);
      }
    }
    ctx.globalAlpha = 1;
  }

  #drawBall(ctx, b, size) {
    const sprite = this.sprites.ball;
    const w = sprite.aspect >= 1 ? size : size * sprite.aspect;
    const h = sprite.aspect >= 1 ? size / sprite.aspect : size;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + size * 0.46, size * 0.38, size * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.translate(b.x, b.y);
    if (!this.reducedMotion) ctx.rotate(this.clock * 4);
    ctx.drawImage(sprite.source, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  #drawFloor(ctx, s, cam) {
    const { floor, grid } = this.config.site.colors;
    const { halfW, halfH } = this.view;
    ctx.fillStyle = floor;
    ctx.fillRect(cam.x - halfW - 2, cam.y - halfH - 2, halfW * 2 + 4, halfH * 2 + 4);

    const x0 = Math.floor((cam.x - halfW) / CELL_SIZE);
    const x1 = Math.floor((cam.x + halfW) / CELL_SIZE);
    const y0 = Math.floor((cam.y - halfH) / CELL_SIZE);
    const y1 = Math.floor((cam.y + halfH) / CELL_SIZE);
    const cells = { x0, x1, y0, y1 };
    if (s.world) {
      this.#drawForestFloor(ctx, s, cam, cells);
      return;
    }
    this.#drawHintCells(ctx, s, cells);

    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const n = cellNoise(cx, cy);
        const left = cx * CELL_SIZE;
        const top = cy * CELL_SIZE;
        if (n > 0.86) {
          ctx.fillStyle = 'rgba(255,255,255,0.022)';
          ctx.fillRect(left, top, CELL_SIZE, CELL_SIZE);
        }
        if (n < 0.05) {
          ctx.fillStyle = grid;
          ctx.fillRect(left + 37, top + 37, 6, 6);
        }
      }
    }

    ctx.beginPath();
    for (let cx = x0; cx <= x1 + 1; cx++) {
      if (cx % 5) { ctx.moveTo(cx * CELL_SIZE, cam.y - halfH); ctx.lineTo(cx * CELL_SIZE, cam.y + halfH); }
    }
    for (let cy = y0; cy <= y1 + 1; cy++) {
      if (cy % 5) { ctx.moveTo(cam.x - halfW, cy * CELL_SIZE); ctx.lineTo(cam.x + halfW, cy * CELL_SIZE); }
    }
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    for (let cx = x0; cx <= x1 + 1; cx++) {
      if (!(cx % 5)) { ctx.moveTo(cx * CELL_SIZE, cam.y - halfH); ctx.lineTo(cx * CELL_SIZE, cam.y + halfH); }
    }
    for (let cy = y0; cy <= y1 + 1; cy++) {
      if (!(cy % 5)) { ctx.moveTo(cam.x - halfW, cy * CELL_SIZE); ctx.lineTo(cam.x + halfW, cy * CELL_SIZE); }
    }
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  #drawHintBeam(ctx, s) {
    const hint = s.hint;
    if (!hint) return;
    const reach = Math.hypot(this.view.halfW, this.view.halfH) * 1.1;
    const alpha = Math.sin(Math.min(1, hint.ttl / hint.total) * Math.PI);
    const { x, y } = s.player;
    const gradient = ctx.createRadialGradient(x, y, 20, x, y, reach);
    const color = this.config.site.colors.accent2;
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, `${color}00`);
    ctx.save();
    ctx.globalAlpha = alpha * 0.38;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, reach, hint.angle - hint.spread / 2, hint.angle + hint.spread / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  #drawArena(ctx, s) {
    const { hostage, boss } = s;
    const arena = this.config.gameplay.arenaRadius;
    const { accent, accent2 } = this.config.site.colors;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hostage.x, hostage.y, arena, 0, TAU);
    ctx.fillStyle = boss.alive ? 'rgba(255,70,90,0.05)' : 'rgba(57,224,194,0.05)';
    ctx.fill();
    ctx.setLineDash([26, 18]);
    ctx.lineDashOffset = -this.clock * 24;
    ctx.lineWidth = 4;
    ctx.strokeStyle = boss.alive ? '#ff4d5e' : accent;
    ctx.stroke();
    ctx.setLineDash([]);

    // The cage around the hostage opens once the boss falls.
    const cage = hostage.r + 26;
    ctx.lineWidth = 5;
    ctx.strokeStyle = boss.alive ? accent2 : accent;
    if (boss.alive) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + this.clock * 0.3;
        ctx.beginPath();
        ctx.arc(hostage.x, hostage.y, cage, a, a + 0.36);
        ctx.stroke();
      }
    } else {
      const pulse = cage + Math.sin(this.clock * 5) * 7;
      ctx.beginPath();
      ctx.arc(hostage.x, hostage.y, pulse, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  #drawActor(ctx, role, a, size, bob = 0) {
    const sprite = this.sprites[role];
    const w = sprite.aspect >= 1 ? size : size * sprite.aspect;
    const h = sprite.aspect >= 1 ? size / sprite.aspect : size;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(a.x, a.y + h * 0.46, w * 0.38, h * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.translate(a.x, a.y + bob);
    ctx.scale(a.face < 0 ? -1 : 1, 1);
    ctx.drawImage(sprite.source, -w / 2, -h / 2, w, h);
    if (a.flash > 0) {
      ctx.globalAlpha = 0.42;
      ctx.drawImage(sprite.flash, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  /** For things seen from above that point where they travel. Altitude moves the shadow away. */
  #drawHeaded(ctx, role, a, size, altitude) {
    const sprite = this.sprites[role];
    const w = sprite.aspect >= 1 ? size : size * sprite.aspect;
    const h = sprite.aspect >= 1 ? size / sprite.aspect : size;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.translate(a.x + altitude, a.y + altitude);
    ctx.rotate(a.heading);
    ctx.drawImage(sprite.flash, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.heading);
    ctx.drawImage(sprite.source, -w / 2, -h / 2, w, h);
    if (a.flash > 0) {
      ctx.globalAlpha = 0.42;
      ctx.drawImage(sprite.flash, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  #drawMissiles(ctx, s) {
    const { size } = this.config.characters.missile;
    for (const m of s.missiles) {
      if (!this.#visible(m)) continue;
      ctx.fillStyle = '#ffb347';
      ctx.globalAlpha = 0.75;
      disc(ctx, m.x - Math.cos(m.heading) * size * 0.55, m.y - Math.sin(m.heading) * size * 0.55, size * (0.14 + Math.random() * 0.1));
      ctx.globalAlpha = 1;
      this.#drawHeaded(ctx, 'missile', m, size, 8);
      // A pulsing ring marks it as something to shoot.
      ctx.strokeStyle = 'rgba(255,77,94,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, size * 0.62 + Math.sin(this.clock * 10) * 3, 0, TAU);
      ctx.stroke();
      this.#miniHealth(ctx, m, m.y - size * 0.8, size, '#ff6b78');
    }
  }

  #drawOrbs(ctx, s) {
    const { accent } = this.config.site.colors;
    ctx.save();
    ctx.fillStyle = accent;
    for (const o of s.orbs) {
      if (!this.#visible(o)) continue;
      const r = (o.xp >= 40 ? 10 : 7) + Math.sin(this.clock * 6 + o.x) * 1.2;
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(o.x, o.y, r * 1.9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y - r);
      ctx.lineTo(o.x + r * 0.8, o.y);
      ctx.lineTo(o.x, o.y + r);
      ctx.lineTo(o.x - r * 0.8, o.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  #drawAimLines(ctx, s) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const e of s.enemies) {
      if (!(e.windup > 0) || !this.#visible(e)) continue;
      const { ball } = this.config.characters;
      const reach = { sniper: 800, pump: 300, ball: ball.speed * 3 }[e.attack];
      ctx.strokeStyle = e.attack === 'ball' ? 'rgba(255,77,94,0.22)' : 'rgba(255,77,94,0.65)';
      ctx.lineWidth = { sniper: 2, pump: 10, ball: ball.size * 0.84 }[e.attack];
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.aim) * reach, e.y + Math.sin(e.aim) * reach);
      ctx.stroke();
    }
    const aim = s.player.aim;
    if (aim) {
      ctx.strokeStyle = this.config.site.colors.accent2;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 12]);
      ctx.beginPath();
      ctx.moveTo(s.player.x + aim.x * 34, s.player.y + aim.y * 34);
      ctx.lineTo(s.player.x + aim.x * 240, s.player.y + aim.y * 240);
      ctx.stroke();
    }
    ctx.restore();
  }

  #label(ctx, text, x, y, color = '#fff', font = 12) {
    ctx.font = `700 ${font}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  #visible(a, margin = 140) {
    const cam = this.camera;
    return Math.abs(a.x - cam.x) < this.view.halfW + margin && Math.abs(a.y - cam.y) < this.view.halfH + margin;
  }

  #miniHealth(ctx, a, y, width, color) {
    if (a.hp >= a.maxHp) return;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(a.x - width / 2, y, width, 5);
    ctx.fillStyle = color;
    ctx.fillRect(a.x - width / 2, y, width * Math.max(0, a.hp / a.maxHp), 5);
  }

  draw(s, dt) {
    const ctx = this.ctx;
    const { characters } = this.config;
    const { accent } = this.config.site.colors;
    this.clock += dt;

    this.camera ??= { x: s.player.x, y: s.player.y };
    const follow = 1 - Math.exp(-dt * 12);
    this.camera.x += (s.player.x - this.camera.x) * follow;
    this.camera.y += (s.player.y - this.camera.y) * follow;
    this.shake = Math.max(0, this.shake - dt * 34);
    const jolt = this.reducedMotion ? 0 : this.shake;
    const cam = {
      x: this.camera.x + (Math.random() - 0.5) * jolt,
      y: this.camera.y + (Math.random() - 0.5) * jolt,
    };

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-cam.x, -cam.y);

    this.#drawFloor(ctx, s, cam);
    this.#drawHintBeam(ctx, s);
    this.#drawArena(ctx, s);
    this.#drawScenery(ctx, s, cam);

    this.#drawOrbs(ctx, s);

    const walk = Math.sin(this.clock * 13) * 2;
    if (this.#visible(s.hostage)) {
      this.#drawActor(ctx, 'hostage', { ...s.hostage, face: 1, flash: 0 }, characters.hostage.size, Math.sin(this.clock * 4) * 1.5);
    }
    for (const e of s.enemies) {
      if (!this.#visible(e, 200)) continue;
      if (e.kind === 'jet') this.#drawHeaded(ctx, 'jet', e, e.size, 34);
      else this.#drawActor(ctx, e.kind, e, e.size, walk);
    }
    if (s.boss.alive && this.#visible(s.boss, 260)) {
      if (s.boss.windup > 0) {
        const a = Math.atan2(s.player.y - s.boss.y, s.player.x - s.boss.x);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,77,94,0.7)';
        ctx.lineWidth = s.boss.r * 1.3;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.28;
        ctx.beginPath();
        ctx.moveTo(s.boss.x, s.boss.y);
        ctx.lineTo(s.boss.x + Math.cos(a) * 560, s.boss.y + Math.sin(a) * 560);
        ctx.stroke();
        ctx.restore();
      }
      this.#drawActor(ctx, 'boss', s.boss, s.boss.size);
    }
    for (const m of s.companions) {
      if (!m.down) this.#drawActor(ctx, 'companion', m, characters.companion.size, walk * 0.7);
    }
    this.#drawAimLines(ctx, s);
    this.#drawActor(ctx, 'player', s.player, characters.player.size, Math.hypot(s.player.vx, s.player.vy) > 5 ? walk : 0);

    this.#drawMissiles(ctx, s);

    for (const p of s.shots) {
      ctx.fillStyle = p.ally ? '#b7f7c4' : accent;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, TAU);
      ctx.fill();
    }
    for (const b of s.bullets) {
      if (b.ball) {
        this.#drawBall(ctx, b, characters.ball.size);
        continue;
      }
      ctx.fillStyle = '#ff6b78';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffe6e0';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU);
      ctx.fill();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = p.ttl / p.total;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    }
    ctx.globalAlpha = 1;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.ttl -= dt;
      if (r.ttl <= 0) { this.rings.splice(i, 1); continue; }
      ctx.globalAlpha = r.ttl / r.total;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.reach * (1 - r.ttl / r.total), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Names go last so that no sprite ever covers them.
    for (const e of s.enemies) {
      if (!this.#visible(e)) continue;
      const { size } = e;
      this.#miniHealth(ctx, e, e.y - size / 2 - 9, size * 0.8, '#ff6b78');
      this.#label(ctx, characters[e.kind].name, e.x, e.y - size / 2 - 13, 'rgba(255,255,255,0.72)', 11);
    }
    if (s.boss.alive && this.#visible(s.boss, 260)) {
      this.#label(ctx, characters.boss.name, s.boss.x, s.boss.y - s.boss.size / 2 - 8, '#ffc247', 15);
    }
    if (this.#visible(s.hostage)) {
      this.#label(ctx, characters.hostage.name, s.hostage.x, s.hostage.y - characters.hostage.size / 2 - 32, '#ffd9a8', 13);
    }
    for (const m of s.companions) {
      if (!m.down) this.#label(ctx, characters.companion.name, m.x, m.y - characters.companion.size / 2 - 7, '#b7f7c4');
    }
    this.#label(ctx, characters.player.name, s.player.x, s.player.y - characters.player.size / 2 - 7, '#fff');
  }
}
