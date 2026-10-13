export interface CameraPose { x: number; y: number; zoom: number }

/** One interruptible camera animation for wheel, buttons and agent selection. */
export class OfficeCamera {
  current: CameraPose = { x: 0, y: 0, zoom: 1 };
  target: CameraPose = { ...this.current };
  private from = { ...this.current };
  private started = 0;
  private duration = 0;
  get moving() { return this.duration > 0; }

  moveTo(pose: CameraPose, animate = true, now = performance.now()) {
    this.step(now);
    this.from = { ...this.current };
    this.target = { ...pose, zoom: Math.max(.25, Math.min(2.5, pose.zoom)) };
    this.started = now;
    this.duration = animate ? 420 : 0;
    if (!animate) this.current = { ...this.target };
  }

  step(now = performance.now()) {
    if (!this.duration) return;
    const t = Math.max(0, Math.min(1, (now - this.started) / this.duration));
    const eased = 1 - (1 - t) ** 3;
    this.current = {
      x: this.from.x + (this.target.x - this.from.x) * eased,
      y: this.from.y + (this.target.y - this.from.y) * eased,
      zoom: this.from.zoom + (this.target.zoom - this.from.zoom) * eased,
    };
    if (t === 1) { this.current = { ...this.target }; this.duration = 0; }
  }

  zoomBy(delta: number, anchor: { x: number; y: number }, animate = true) {
    this.step();
    const zoom = Math.max(.25, Math.min(2.5, this.target.zoom + delta));
    const ratio = zoom / this.current.zoom;
    this.moveTo({ x: anchor.x - (anchor.x - this.current.x) * ratio,
      y: anchor.y - (anchor.y - this.current.y) * ratio, zoom }, animate);
  }

  pan(dx: number, dy: number) {
    this.step();
    this.moveTo({ ...this.current, x: this.current.x + dx, y: this.current.y + dy }, false);
  }

  /** Resize preserves the viewed world point, including during an animation. */
  resize(dx: number, dy: number) {
    for (const pose of [this.current, this.from, this.target]) { pose.x += dx; pose.y += dy; }
  }
}
