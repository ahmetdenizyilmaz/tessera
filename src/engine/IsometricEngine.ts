import { Application, Container, Graphics, Matrix, Rectangle, Text } from 'pixi.js';
import type { OfficeLayout, OfficeFurniture } from '../types/office';
import { drawOfficeCharacter, drawOfficeFurniture, drawSpeechBubble, type BubbleKind } from './officeArt';
import type { WorkerPose } from './WorkerAnimator';

const ROOM_NAMES: Record<string, string> = { reception: 'WELCOME', open_floor: 'THE STUDIO', manager_office: 'YOUR OFFICE', meeting_room: 'PLANNING', server_room: 'BUILD LAB', break_room: 'COFFEE LOUNGE', archive: 'LIBRARY', computer_lab: 'RESEARCH', maintenance: 'SUPPORT' };
export class IsometricEngine {
  app = new Application();
  private world = new Container();
  private floor = new Container();
  private walls = new Container();
  private entities = new Container();
  private labels = new Container();
  private links = new Graphics();
  private bubbles = new Container();
  private grid = new Graphics();
  private ghost = new Graphics();
  private ready = false;
  private disposed = false;
  private cameraX = 0;
  private cameraY = 0;
  private zoomLevel = 1;
  private layout: OfficeLayout | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cleanup: (() => void) | null = null;
  private workerGraphics = new Map<string, { body: Graphics; label: Text; bubble: Graphics; glyph: Text; key: string; bubbleKey: string }>();
  private onTileClickHandler?: (gx: number, gy: number) => void;
  private onWorkerClickHandler?: (id: string) => void;
  private onBackgroundClickHandler?: () => void;
  private onWorkerHoverHandler?: (id: string | null, x: number, y: number) => void;
  private edit = false;
  static readonly TILE_WIDTH = 64;
  static readonly TILE_HEIGHT = 32;

  async init(parent: HTMLElement) {
    await this.app.init({ width: parent.clientWidth || 800, height: parent.clientHeight || 600, background: '#17282e', antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    if (this.disposed) { this.app.destroy(true, { children: true }); return; }
    this.ready = true;
    parent.appendChild(this.app.canvas);
    this.world.addChild(this.floor, this.walls, this.entities, this.links, this.labels, this.bubbles, this.grid, this.ghost);
    this.app.stage.addChild(this.world);
    this.entities.sortableChildren = true;
    this.labels.eventMode = 'none'; this.grid.eventMode = 'none'; this.ghost.eventMode = 'none'; this.links.eventMode = 'none'; this.bubbles.eventMode = 'none';
    this.resizeObserver = new ResizeObserver(() => { if (parent.clientWidth && parent.clientHeight) { this.app.renderer.resize(parent.clientWidth, parent.clientHeight); this.centerCamera(); } });
    this.resizeObserver.observe(parent);
    this.setupInteraction(parent);
  }
  destroy() {
    this.disposed = true; this.cleanup?.(); this.resizeObserver?.disconnect();
    if (this.ready) { this.app.destroy(true, { children: true }); this.ready = false; }
  }
  gridToScreen(gx: number, gy: number) { return { x: (gx - gy) * 32, y: (gx + gy) * 16 }; }
  screenToGrid(x: number, y: number) { return { gx: Math.floor((x / 32 + y / 16) / 2), gy: Math.floor((y / 16 - x / 32) / 2) }; }
  private clear(container: Container) { container.removeChildren().forEach(child => child.destroy({ children: true })); }
  drawFloor(layout: OfficeLayout) {
    this.layout = layout;
    this.clear(this.floor);
    const colors: Record<string, number> = { default: 0x849183, carpet: 0x6b8990, wood: 0x9d886c, marble: 0xa3afa3, server: 0x637b83, meeting: 0x8b979c, break_room: 0xa09b80, archive: 0x8f9c81, manager: 0x9d886c, computer_lab: 0x739590, maintenance: 0x829091 };
    const g = new Graphics();
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
      const p = this.gridToScreen(x, y), color = colors[layout.floorTiles[`${x},${y}`]] ?? colors.default;
      g.poly([p.x, p.y, p.x + 32, p.y + 16, p.x, p.y + 32, p.x - 32, p.y + 16]).fill({ color, alpha: (x + y) % 2 ? .97 : 1 }).stroke({ color: 0x283c3e, alpha: .13, width: 1 });
    }
    g.eventMode = 'none'; this.floor.addChild(g);
    for (const room of layout.rooms) {
      const { x, y, w, h } = room.bounds;
      const name = ROOM_NAMES[room.type] ?? room.type;
      const label = new Text({ text: w <= 6 ? name.replace(' ', '\n') : name, style: {
        fontFamily: 'Segoe UI, sans-serif', fontSize: 40, lineHeight: 42, fontWeight: '800',
        fill: 0xf5f1da, letterSpacing: 2, align: 'center',
      } });
      label.anchor.set(.5);
      const scale = Math.min(1, (w - .9) * 32 / label.width, (h - .6) * 32 / label.height);
      const p = this.gridToScreen(x + w / 2, y + h - .4 - label.height * scale / 64);
      // Both text axes follow the tile axes: the lettering lies on the floor.
      label.setFromMatrix(new Matrix(scale, scale / 2, -scale, scale / 2, p.x, p.y));
      label.alpha = .86; label.eventMode = 'none'; label.label = 'room-name';
      this.floor.addChild(label);
    }
  }
  drawWalls(layout: OfficeLayout) {
    this.clear(this.walls);
    const g = new Graphics();
    for (const room of layout.rooms) {
      const { x, y, w, h } = room.bounds;
      const a = this.gridToScreen(x, y), b = this.gridToScreen(x + w, y), c = this.gridToScreen(x, y + h);
      g.poly([a.x, a.y, b.x, b.y, b.x, b.y - 15, a.x, a.y - 15]).fill(0xc8cebd);
      g.poly([a.x, a.y, c.x, c.y, c.x, c.y - 15, a.x, a.y - 15]).fill(0xa8b6ac);
    }
    g.eventMode = 'none'; this.walls.addChildAt(g, 0);
  }
  drawFurniture(furniture: OfficeFurniture[]) {
    for (const child of [...this.entities.children]) if (child.label === 'furniture') { this.entities.removeChild(child); child.destroy({ children: true }); }
    for (const f of furniture) {
      const g = new Graphics(); g.label = 'furniture'; g.eventMode = 'none';
      drawOfficeFurniture(g, f.type);
      const p = this.gridToScreen(f.position.gridX, f.position.gridY);
      g.position.set(p.x, p.y + 12); g.scale.x = f.rotation % 2 ? -1 : 1;
      g.zIndex = f.type === 'rug' ? -10000 : p.y + 16;
      this.entities.addChild(g);
    }
  }
  syncWorkers(ids: string[]) {
    for (const [id, worker] of this.workerGraphics) if (!ids.includes(id)) { worker.body.destroy(); worker.label.destroy(); worker.bubble.destroy(); worker.glyph.destroy(); this.workerGraphics.delete(id); }
    for (const id of ids) if (!this.workerGraphics.has(id)) {
      const body = new Graphics(); body.eventMode = 'static'; body.cursor = 'pointer'; body.hitArea = new Rectangle(-17, -55, 34, 65);
      body.on('pointerover', e => { if (!this.edit) this.onWorkerHoverHandler?.(id, e.global.x, e.global.y); });
      body.on('pointerout', () => this.onWorkerHoverHandler?.(null, 0, 0));
      const label = new Text({ text: '', style: { fontFamily: 'Segoe UI, sans-serif', fontSize: 12, fontWeight: '600', fill: 0xf4f3df, stroke: { color: 0x1b3034, width: 3 }, align: 'center' } });
      label.anchor.set(.5, 0); label.eventMode = 'none';
      const bubble = new Graphics(); bubble.eventMode = 'none'; bubble.visible = false;
      const glyph = new Text({ text: '', style: { fontFamily: 'Segoe UI, sans-serif', fontSize: 13, fontWeight: '800', fill: 0x2a3a44, align: 'center' } });
      glyph.anchor.set(.5); glyph.eventMode = 'none'; glyph.visible = false;
      this.entities.addChild(body); this.labels.addChild(label); this.bubbles.addChild(bubble, glyph);
      this.workerGraphics.set(id, { body, label, bubble, glyph, key: '', bubbleKey: '' });
    }
  }
  updateWorkerPositions(positions: Map<string, WorkerPose>) {
    for (const [id, pos] of positions) {
      const w = this.workerGraphics.get(id); if (!w) continue;
      const p = this.gridToScreen(pos.x + .5, pos.y + .5);
      w.body.position.set(p.x, p.y); w.body.zIndex = p.y;
      w.label.position.set(p.x, p.y + 10);
      w.bubble.position.set(p.x, p.y); w.glyph.position.set(p.x, p.y - 72);
    }
  }
  updateWorkerGraphic(id: string, color: number, activity: string, name: string, provider = '', wearables = '', walking = false, frame = 0, appearanceId = id) {
    const w = this.workerGraphics.get(id); if (!w) return;
    const key = [color, activity, name, provider, wearables, walking, walking ? frame % 2 : 0, appearanceId].join(':');
    if (key === w.key) return;
    w.key = key; drawOfficeCharacter(w.body, appearanceId, color, wearables, frame, walking, activity);
    w.label.text = `${name.length > 22 ? name.slice(0, 21) + '…' : name}\n${provider}`;
  }
  /** The bubble over a character: animated dots while it works, a glyph when it needs
   * someone, a tinted bubble while it is messaging another agent. */
  updateWorkerBubble(id: string, kind: BubbleKind, frame = 0) {
    const w = this.workerGraphics.get(id); if (!w) return;
    const key = kind ? `${kind}:${kind === 'dots' || kind === 'talk' ? frame % 3 : 0}` : '';
    if (key === w.bubbleKey) return;
    w.bubbleKey = key;
    w.bubble.visible = !!kind; w.glyph.visible = kind === 'question' || kind === 'alert';
    if (!kind) return;
    drawSpeechBubble(w.bubble, kind, frame);
    w.glyph.text = kind === 'question' ? '?' : kind === 'alert' ? '!' : '';
  }
  /** Lines from each sender to its receiver, with a dot travelling along (progress 0..1). */
  drawLinks(links: Array<{ from: string; to: string; progress: number; color: number }>) {
    this.links.clear();
    for (const link of links) {
      const a = this.workerGraphics.get(link.from), b = this.workerGraphics.get(link.to); if (!a || !b) continue;
      const ax = a.body.x, ay = a.body.y - 60, bx = b.body.x, by = b.body.y - 60;
      const cx = (ax + bx) / 2, cy = Math.min(ay, by) - 40 - Math.hypot(bx - ax, by - ay) / 6;
      this.links.moveTo(ax, ay).quadraticCurveTo(cx, cy, bx, by).stroke({ color: link.color, width: 2, alpha: .55 });
      const t = link.progress, x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx, y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
      this.links.circle(x, y, 4).fill({ color: 0xf7f4e8 }).stroke({ color: link.color, width: 2 });
    }
  }
  centerCamera() {
    if (!this.ready || !this.layout) return;
    const { width, height } = this.layout;
    const spanX = (width + height) * 32, spanY = (width + height) * 16;
    this.zoomLevel = Math.max(.25, Math.min(1.25, (this.app.screen.width - 90) / spanX, (this.app.screen.height - 100) / spanY));
    this.cameraX = this.app.screen.width / 2 - (width - height) * 16 * this.zoomLevel;
    this.cameraY = (this.app.screen.height - spanY * this.zoomLevel) / 2 + 18;
    this.updateCamera();
  }
  zoomBy(delta: number) { this.zoomLevel = Math.max(.25, Math.min(2.5, this.zoomLevel + delta)); this.updateCamera(); }
  private updateCamera() { this.world.position.set(this.cameraX, this.cameraY); this.world.scale.set(this.zoomLevel); }
  onTileClick(handler?: (gx: number, gy: number) => void) { this.onTileClickHandler = handler; }
  onWorkerClick(handler: (id: string) => void) { this.onWorkerClickHandler = handler; }
  onBackgroundClick(handler: () => void) { this.onBackgroundClickHandler = handler; }
  onWorkerHover(handler: (id: string | null, x: number, y: number) => void) { this.onWorkerHoverHandler = handler; }
  showGrid(layout: OfficeLayout, enabled: boolean) {
    this.edit = enabled; this.grid.clear(); this.ghost.clear();
    if (!enabled) return;
    for (let y = 0; y <= layout.height; y++) { const a = this.gridToScreen(0, y), b = this.gridToScreen(layout.width, y); this.grid.moveTo(a.x, a.y).lineTo(b.x, b.y); }
    for (let x = 0; x <= layout.width; x++) { const a = this.gridToScreen(x, 0), b = this.gridToScreen(x, layout.height); this.grid.moveTo(a.x, a.y).lineTo(b.x, b.y); }
    this.grid.stroke({ color: 0xffffff, alpha: .25, width: 1 });
  }
  private setupInteraction(parent: HTMLElement) {
    let dragging = false, downX = 0, downY = 0, lastX = 0, lastY = 0, panning = false, moved = false;
    let pressedWorker: string | undefined;
    const workerAt = (e: PointerEvent) => {
      const r = parent.getBoundingClientRect();
      const x = (e.clientX - r.left - this.cameraX) / this.zoomLevel, y = (e.clientY - r.top - this.cameraY) / this.zoomLevel;
      // Match the sprite hit area and the renderer's front-to-back ordering.
      return [...this.workerGraphics].sort((a, b) => b[1].body.zIndex - a[1].body.zIndex)
        .find(([, { body }]) => body.hitArea?.contains(x - body.x, y - body.y))?.[0];
    };
    const point = (e: PointerEvent) => { const r = parent.getBoundingClientRect(); return this.screenToGrid((e.clientX - r.left - this.cameraX) / this.zoomLevel, (e.clientY - r.top - this.cameraY) / this.zoomLevel); };
    const down = (e: PointerEvent) => { if (e.button > 1) return; dragging = true; moved = e.shiftKey || e.button !== 0; pressedWorker = workerAt(e); panning = e.shiftKey || e.button === 1 || !this.edit; downX = lastX = e.clientX; downY = lastY = e.clientY; };
    const move = (e: PointerEvent) => {
      if (dragging && Math.hypot(e.clientX - downX, e.clientY - downY) >= 5) moved = true;
      if (dragging && panning) { this.cameraX += e.clientX - lastX; this.cameraY += e.clientY - lastY; this.updateCamera(); }
      lastX = e.clientX; lastY = e.clientY;
      this.ghost.clear();
      if (this.edit && this.layout) { const { gx, gy } = point(e); if (gx >= 0 && gy >= 0 && gx < this.layout.width && gy < this.layout.height) { const p = this.gridToScreen(gx, gy); this.ghost.poly([p.x, p.y, p.x + 32, p.y + 16, p.x, p.y + 32, p.x - 32, p.y + 16]).fill({ color: 0xf4d492, alpha: .4 }).stroke({ color: 0xffe0a5, width: 2 }); } }
    };
    const up = (e: PointerEvent) => {
      if (dragging && !moved && e.button === 0 && Math.hypot(e.clientX - downX, e.clientY - downY) < 5) {
        if (this.edit && !panning) { const { gx, gy } = point(e); this.onTileClickHandler?.(gx, gy); }
        else if (!this.edit) {
          const worker = workerAt(e);
          if (worker && worker === pressedWorker) this.onWorkerClickHandler?.(worker);
          else if (!worker && !pressedWorker) this.onBackgroundClickHandler?.();
        }
      }
      dragging = false;
    };
    const leave = () => { dragging = false; this.ghost.clear(); this.onWorkerHoverHandler?.(null, 0, 0); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.zoomBy(e.deltaY > 0 ? -.08 : .08); };
    parent.addEventListener('pointerdown', down); parent.addEventListener('pointermove', move); parent.addEventListener('pointerup', up); parent.addEventListener('pointerleave', leave); parent.addEventListener('pointercancel', leave); parent.addEventListener('wheel', wheel, { passive: false });
    this.cleanup = () => { parent.removeEventListener('pointerdown', down); parent.removeEventListener('pointermove', move); parent.removeEventListener('pointerup', up); parent.removeEventListener('pointerleave', leave); parent.removeEventListener('pointercancel', leave); parent.removeEventListener('wheel', wheel); };
  }
}
