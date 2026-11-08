// Analog on-screen joystick driven by Pointer Events (touch, pen or mouse).

const DEAD_ZONE = 0.14;

export class Joystick {
  constructor(base, knob) {
    this.base = base;
    this.knob = knob;
    this.vector = { x: 0, y: 0 };
    this.pointer = null;
    base.addEventListener('pointerdown', (e) => this.#start(e));
    base.addEventListener('pointermove', (e) => this.#move(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      base.addEventListener(type, (e) => this.#end(e));
    }
    base.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #start(e) {
    if (this.pointer !== null) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    this.base.setPointerCapture(e.pointerId);
    this.#update(e);
  }

  #move(e) {
    if (e.pointerId === this.pointer) this.#update(e);
  }

  #end(e) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.reset();
  }

  #update(e) {
    const box = this.base.getBoundingClientRect();
    const reach = box.width * 0.5;
    let dx = (e.clientX - (box.left + reach)) / reach;
    let dy = (e.clientY - (box.top + reach)) / reach;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    const limited = Math.min(mag, 1);
    this.#place(dx * reach * 0.62, dy * reach * 0.62);
    if (limited < DEAD_ZONE) {
      this.vector = { x: 0, y: 0 };
      return;
    }
    // Rescale past the dead zone so light pushes still start from a slow walk.
    const power = (limited - DEAD_ZONE) / (1 - DEAD_ZONE) / (limited || 1);
    this.vector = { x: dx * power, y: dy * power };
  }

  #place(x, y) {
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  reset() {
    this.vector = { x: 0, y: 0 };
    this.#place(0, 0);
  }
}
