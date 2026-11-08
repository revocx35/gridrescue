// Draws the simulation state on a canvas. Holds no game rules.
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
};

export function defaultSprite(role) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ART_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.scale(ART_SIZE / 100, ART_SIZE / 100);
  ART[role](ctx);
  return canvas;
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

/** Loads every role's sprite, falling back to the built-in art when a PNG is missing or broken. */
export async function loadSprites(config) {
  const sprites = {};
  await Promise.all(
    Object.entries(config.characters).map(async ([role, ch]) => {
      const image = ch.spriteUrl ? await loadImage(ch.spriteUrl) : null;
      sprites[role] = image
        ? makeSprite(image, image.naturalWidth, image.naturalHeight)
        : makeSprite(defaultSprite(role), ART_SIZE, ART_SIZE);
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
      this.burst(event.x, event.y, event.kind === 'enemy1' ? '#ff6b78' : '#f07ac0', event.kind === 'enemy1' ? 26 : 14);
      this.shake = Math.max(this.shake, event.kind === 'enemy1' ? 7 : 2);
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

  #drawFloor(ctx, s, cam) {
    const { floor, grid, accent2 } = this.config.site.colors;
    const { halfW, halfH } = this.view;
    ctx.fillStyle = floor;
    ctx.fillRect(cam.x - halfW - 2, cam.y - halfH - 2, halfW * 2 + 4, halfH * 2 + 4);

    const x0 = Math.floor((cam.x - halfW) / CELL_SIZE);
    const x1 = Math.floor((cam.x + halfW) / CELL_SIZE);
    const y0 = Math.floor((cam.y - halfH) / CELL_SIZE);
    const y1 = Math.floor((cam.y + halfH) / CELL_SIZE);
    const hint = s.hint;
    const hintAlpha = hint ? Math.sin(Math.min(1, hint.ttl / hint.total) * Math.PI) : 0;

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
        if (hint) {
          const mx = left + CELL_SIZE / 2 - s.player.x;
          const my = top + CELL_SIZE / 2 - s.player.y;
          const d = Math.hypot(mx, my);
          if (d > 30 && angleDelta(Math.atan2(my, mx), hint.angle) < hint.spread / 2) {
            ctx.globalAlpha = hintAlpha * (0.14 + 0.3 * (n * 0.5 + 0.5));
            ctx.fillStyle = accent2;
            ctx.fillRect(left + 1, top + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            ctx.globalAlpha = 1;
          }
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

    const walk = Math.sin(this.clock * 13) * 2;
    if (this.#visible(s.hostage)) {
      this.#drawActor(ctx, 'hostage', { ...s.hostage, face: 1, flash: 0 }, characters.hostage.size, Math.sin(this.clock * 4) * 1.5);
    }
    for (const e of s.enemies) {
      if (this.#visible(e)) this.#drawActor(ctx, e.kind, e, characters[e.kind].size, walk);
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
      this.#drawActor(ctx, 'boss', s.boss, characters.boss.size);
    }
    if (s.companion && !s.companion.down) {
      this.#drawActor(ctx, 'companion', s.companion, characters.companion.size, walk * 0.7);
    }
    this.#drawActor(ctx, 'player', s.player, characters.player.size, Math.hypot(s.player.vx, s.player.vy) > 5 ? walk : 0);

    for (const p of s.shots) {
      ctx.fillStyle = p.ally ? '#b7f7c4' : accent;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, TAU);
      ctx.fill();
    }
    for (const b of s.bullets) {
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
      const size = characters[e.kind].size;
      this.#miniHealth(ctx, e, e.y - size / 2 - 9, size * 0.8, '#ff6b78');
      this.#label(ctx, characters[e.kind].name, e.x, e.y - size / 2 - 13, 'rgba(255,255,255,0.72)', 11);
    }
    if (s.boss.alive && this.#visible(s.boss, 260)) {
      this.#label(ctx, characters.boss.name, s.boss.x, s.boss.y - characters.boss.size / 2 - 8, '#ffc247', 15);
    }
    if (this.#visible(s.hostage)) {
      this.#label(ctx, characters.hostage.name, s.hostage.x, s.hostage.y - characters.hostage.size / 2 - 32, '#ffd9a8', 13);
    }
    if (s.companion && !s.companion.down) {
      this.#label(ctx, characters.companion.name, s.companion.x, s.companion.y - characters.companion.size / 2 - 7, '#b7f7c4');
    }
    this.#label(ctx, characters.player.name, s.player.x, s.player.y - characters.player.size / 2 - 7, '#fff');
  }
}
