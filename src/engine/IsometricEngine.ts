import { Application, Container, Graphics, Rectangle } from 'pixi.js';
import type { OfficeLayout, OfficeFurniture, OfficeWorker, GridPosition } from '../types/office';

export class IsometricEngine {
  app: Application;
  private floorContainer: Container;
  private wallContainer: Container;
  private entityContainer: Container;
  private uiContainer: Container;

  private cameraX = 0;
  private cameraY = 0;
  private zoomLevel = 1;

  static readonly TILE_WIDTH = 64;
  static readonly TILE_HEIGHT = 32;

  private onTileClickHandler?: (gx: number, gy: number) => void;
  private onWorkerClickHandler?: (instanceId: string) => void;
  private onWorkerHoverHandler?: (instanceId: string | null, screenX: number, screenY: number) => void;

  private workerGraphics: Map<string, Graphics> = new Map();
  private workerActivityCache: Map<string, string> = new Map(); // track last drawn activity
  private furnitureGraphics: Map<string, Graphics> = new Map();

  private parentEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private floorLayout: OfficeLayout | null = null; // cached for click hit-testing

  constructor() {
    this.app = new Application();
    this.floorContainer = new Container();
    this.wallContainer = new Container();
    this.entityContainer = new Container();
    this.uiContainer = new Container();
  }

  async init(parent: HTMLElement): Promise<void> {
    this.parentEl = parent;
    const width = parent.clientWidth || 800;
    const height = parent.clientHeight || 600;

    await this.app.init({
      width,
      height,
      background: '#1a1a2e',
      antialias: true,
    });
    parent.appendChild(this.app.canvas as HTMLCanvasElement);

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          this.app.renderer.resize(w, h);
        }
      }
    });
    this.resizeObserver.observe(parent);

    const worldContainer = new Container();
    worldContainer.addChild(this.floorContainer);
    worldContainer.addChild(this.wallContainer);
    worldContainer.addChild(this.entityContainer);
    this.app.stage.addChild(worldContainer);
    this.app.stage.addChild(this.uiContainer);

    this.setupInteraction(parent);
    this.centerCamera();
  }

  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    try {
      this.app.destroy(true, { children: true });
    } catch {
      // Ignore destroy errors during unmount
    }
    this.parentEl = null;
  }

  // Isometric projection: grid -> screen
  gridToScreen(gx: number, gy: number): { x: number; y: number } {
    const TW = IsometricEngine.TILE_WIDTH;
    const TH = IsometricEngine.TILE_HEIGHT;
    return {
      x: (gx - gy) * (TW / 2),
      y: (gx + gy) * (TH / 2),
    };
  }

  // Reverse: screen -> grid
  screenToGrid(sx: number, sy: number): { gx: number; gy: number } {
    const TW = IsometricEngine.TILE_WIDTH;
    const TH = IsometricEngine.TILE_HEIGHT;
    return {
      gx: Math.round((sx / (TW / 2) + sy / (TH / 2)) / 2),
      gy: Math.round((sy / (TH / 2) - sx / (TW / 2)) / 2),
    };
  }

  // Draw all floor tiles as ONE batched Graphics — no individual event listeners
  drawFloor(layout: OfficeLayout): void {
    this.floorContainer.removeChildren();
    this.floorLayout = layout;

    const TW = IsometricEngine.TILE_WIDTH;
    const TH = IsometricEngine.TILE_HEIGHT;

    const colors: Record<string, number> = {
      default: 0x2d2d4e,
      carpet: 0x3d3d6e,
      wood: 0x5c4033,
      marble: 0x8e8e8e,
      server: 0x1a2a1a,
      meeting: 0x2a2a5e,
      break_room: 0x3e2a2a,
      archive: 0x2a3e2a,
      manager: 0x3e3e1a,
      computer_lab: 0x1a3e3e,
      reception: 0x3e3e3e,
      maintenance: 0x2a1a1a,
    };

    // Group tiles by style so we batch fills
    const tilesByStyle = new Map<string, { gx: number; gy: number }[]>();
    for (let gy = 0; gy < layout.height; gy++) {
      for (let gx = 0; gx < layout.width; gx++) {
        const style = layout.floorTiles[`${gx},${gy}`] || 'default';
        let arr = tilesByStyle.get(style);
        if (!arr) { arr = []; tilesByStyle.set(style, arr); }
        arr.push({ gx, gy });
      }
    }

    // One Graphics per style (much fewer draw calls than 600 individual objects)
    for (const [style, tiles] of tilesByStyle) {
      const g = new Graphics();
      const color = colors[style] ?? colors.default;
      for (const { gx, gy } of tiles) {
        const { x, y } = this.gridToScreen(gx, gy);
        g.poly([
          { x: x, y: y },
          { x: x + TW / 2, y: y + TH / 2 },
          { x: x, y: y + TH },
          { x: x - TW / 2, y: y + TH / 2 },
        ]);
        g.fill({ color, alpha: 0.9 });
        g.stroke({ color: 0x444466, width: 1, alpha: 0.3 });
      }
      g.eventMode = 'none'; // no per-tile events
      this.floorContainer.addChild(g);
    }

    // Single invisible hit area for tile clicks (only used in edit mode)
    const hitArea = new Graphics();
    hitArea.rect(
      -layout.width * TW, 0,
      layout.width * TW * 2, layout.height * TH * 2,
    );
    hitArea.fill({ color: 0x000000, alpha: 0.001 });
    hitArea.eventMode = 'static';
    hitArea.on('pointerdown', (e) => {
      if (!this.onTileClickHandler) return;
      const world = this.app.stage.children[0];
      const localX = (e.global.x - world.x) / this.zoomLevel;
      const localY = (e.global.y - world.y) / this.zoomLevel;
      const { gx, gy } = this.screenToGrid(localX, localY);
      if (gx >= 0 && gy >= 0 && this.floorLayout &&
          gx < this.floorLayout.width && gy < this.floorLayout.height) {
        this.onTileClickHandler(gx, gy);
      }
    });
    this.floorContainer.addChild(hitArea);
  }

  drawWalls(layout: OfficeLayout): void {
    this.wallContainer.removeChildren();
    // One Graphics for ALL walls
    const g = new Graphics();
    const TW = IsometricEngine.TILE_WIDTH;
    const TH = IsometricEngine.TILE_HEIGHT;
    const WALL_HEIGHT = 20;

    for (const room of layout.rooms) {
      const { x: bx, y: by, w: bw, h: bh } = room.bounds;

      for (let gx = bx; gx < bx + bw; gx++) {
        const { x, y } = this.gridToScreen(gx, by);
        g.poly([
          { x, y }, { x: x + TW / 2, y: y + TH / 2 },
          { x: x + TW / 2, y: y + TH / 2 - WALL_HEIGHT },
          { x, y: y - WALL_HEIGHT },
        ]);
        g.fill({ color: 0x556677, alpha: 0.8 });
        g.stroke({ color: 0x778899, width: 1 });
      }
      for (let gy = by; gy < by + bh; gy++) {
        const { x, y } = this.gridToScreen(bx, gy);
        g.poly([
          { x, y }, { x: x - TW / 2, y: y + TH / 2 },
          { x: x - TW / 2, y: y + TH / 2 - WALL_HEIGHT },
          { x, y: y - WALL_HEIGHT },
        ]);
        g.fill({ color: 0x445566, alpha: 0.8 });
        g.stroke({ color: 0x778899, width: 1 });
      }
    }
    g.eventMode = 'none';
    this.wallContainer.addChild(g);
  }

  drawFurniture(furniture: OfficeFurniture[]): void {
    const activeIds = new Set(furniture.map(f => f.id));
    for (const [id, g] of this.furnitureGraphics) {
      if (!activeIds.has(id)) {
        this.entityContainer.removeChild(g);
        g.destroy();
        this.furnitureGraphics.delete(id);
      }
    }
    for (const f of furniture) {
      let g = this.furnitureGraphics.get(f.id);
      if (!g) {
        g = new Graphics();
        g.eventMode = 'none';
        this.furnitureGraphics.set(f.id, g);
        this.entityContainer.addChild(g);
      }
      const { x, y } = this.gridToScreen(f.position.gridX, f.position.gridY);
      g.clear();
      this.drawFurnitureItem(g, f.type, x, y);
    }
  }

  // Only update worker positions — don't recreate graphics each frame
  updateWorkerPositions(positions: Map<string, { x: number; y: number }>): void {
    for (const [id, pos] of positions) {
      const g = this.workerGraphics.get(id);
      if (g) {
        const screen = this.gridToScreen(pos.x, pos.y);
        g.x = screen.x;
        g.y = screen.y;
      }
    }
    // Only sort if we have workers
    if (this.workerGraphics.size > 0) {
      this.sortEntities();
    }
  }

  // Create or remove worker graphics — call only when workers are added/removed
  syncWorkers(workerIds: string[]): void {
    const activeIds = new Set(workerIds);
    for (const [id, g] of this.workerGraphics) {
      if (!activeIds.has(id)) {
        this.entityContainer.removeChild(g);
        g.destroy();
        this.workerGraphics.delete(id);
        this.workerActivityCache.delete(id);
      }
    }
    for (const id of workerIds) {
      if (!this.workerGraphics.has(id)) {
        const g = new Graphics();
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.hitArea = new Rectangle(-16, -40, 32, 48); // generous hit area around worker
        g.on('pointerdown', () => this.onWorkerClickHandler?.(id));
        g.on('pointerover', (e) => {
          this.onWorkerHoverHandler?.(id, e.global.x, e.global.y);
        });
        g.on('pointerout', () => this.onWorkerHoverHandler?.(null, 0, 0));
        this.workerGraphics.set(id, g);
        this.entityContainer.addChild(g);
      }
    }
  }

  // Only redraw worker graphic when activity actually changes
  updateWorkerGraphic(instanceId: string, color: number, activity: string, _name: string): void {
    const cached = this.workerActivityCache.get(instanceId);
    if (cached === `${color}:${activity}`) return; // skip if unchanged
    this.workerActivityCache.set(instanceId, `${color}:${activity}`);

    const g = this.workerGraphics.get(instanceId);
    if (!g) return;

    g.clear();

    // --- Pixel-art style rectangular character ---
    // All coordinates relative to (0,0) = feet position

    // Shadow (isometric ellipse on the ground)
    g.ellipse(0, 0, 8, 4);
    g.fill({ color: 0x000000, alpha: 0.3 });

    // Legs (two small rectangles)
    g.rect(-4, -8, 3, 8);
    g.fill({ color: 0x334455 }); // dark pants
    g.rect(1, -8, 3, 8);
    g.fill({ color: 0x334455 });

    // Body (main torso — provider color)
    g.rect(-6, -22, 12, 14);
    g.fill({ color });
    // Body outline
    g.rect(-6, -22, 12, 14);
    g.stroke({ color: 0x000000, width: 1, alpha: 0.3 });

    // Arms
    g.rect(-9, -20, 3, 10);
    g.fill({ color: (color & 0xfefefe) >> 1 }); // darker shade
    g.rect(6, -20, 3, 10);
    g.fill({ color: (color & 0xfefefe) >> 1 });

    // Head (skin-colored rectangle)
    g.rect(-5, -30, 10, 8);
    g.fill({ color: 0xFFDBB4 });
    g.rect(-5, -30, 10, 8);
    g.stroke({ color: 0x000000, width: 1, alpha: 0.2 });

    // Eyes (two dark pixels)
    g.rect(-3, -27, 2, 2);
    g.fill({ color: 0x222222 });
    g.rect(1, -27, 2, 2);
    g.fill({ color: 0x222222 });

    // Hair (top of head)
    g.rect(-5, -33, 10, 3);
    g.fill({ color: 0x3a2a1a });

    // Activity indicator bubble (floating above head)
    const indicatorColors: Record<string, number> = {
      idle: 0x888888, new: 0x44ff44, thinking: 0xffff44,
      responding: 0x44ff44, reading_file: 0x4488ff,
      editing_file: 0xff8844, writing_file: 0xff8844,
      running_command: 0xff4444, searching_files: 0x44ffff,
      searching_web: 0x8844ff, managing_todos: 0xffaa00,
      awaiting_permission: 0xff0000, error: 0xff0000,
      using_tool: 0xaaaaaa,
    };
    const indColor = indicatorColors[activity] ?? 0x888888;

    // Bubble background
    g.roundRect(-6, -44, 12, 8, 3);
    g.fill({ color: 0x111122, alpha: 0.8 });
    g.stroke({ color: indColor, width: 1 });

    // Bubble dot
    g.circle(0, -40, 2);
    g.fill({ color: indColor });
  }

  // Kept for backward compat but now unused by render loop
  drawWorkers(workers: Record<string, OfficeWorker>): void {
    this.syncWorkers(Object.keys(workers));
    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, w] of Object.entries(workers)) {
      positions.set(id, w.position);
    }
    this.updateWorkerPositions(positions);
  }

  sortEntities(): void {
    this.entityContainer.children.sort((a, b) => a.y - b.y);
  }

  centerCamera(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.cameraX = w / 2;
    this.cameraY = h / 4;
    this.updateCamera();
  }

  panTo(x: number, y: number): void {
    this.cameraX = x;
    this.cameraY = y;
    this.updateCamera();
  }

  zoom(level: number): void {
    this.zoomLevel = Math.max(0.25, Math.min(3, level));
    this.updateCamera();
  }

  private updateCamera(): void {
    const world = this.app.stage.children[0];
    if (world) {
      world.x = this.cameraX;
      world.y = this.cameraY;
      world.scale.set(this.zoomLevel);
    }
  }

  onTileClick(handler: (gx: number, gy: number) => void): void {
    this.onTileClickHandler = handler;
  }
  onWorkerClick(handler: (instanceId: string) => void): void {
    this.onWorkerClickHandler = handler;
  }
  onWorkerHover(handler: (instanceId: string | null, screenX: number, screenY: number) => void): void {
    this.onWorkerHoverHandler = handler;
  }

  private drawFurnitureItem(g: Graphics, type: string, x: number, y: number): void {
    const colors: Record<string, number> = {
      desk: 0x8B6914, chair: 0x4a4a4a, filing_cabinet: 0x6B7B8D,
      whiteboard: 0xf0f0f0, coffee_machine: 0x3a3a3a, couch: 0x8B4513,
      plant: 0x228B22, bookshelf: 0x654321, server_rack: 0x2a2a2a,
      printer: 0xd3d3d3, water_cooler: 0x87CEEB, task_board: 0xDEB887,
      lamp: 0xFFD700, rug: 0x8B0000, poster: 0xFF6347,
    };
    const color = colors[type] ?? 0x888888;
    const hw = 12, hh = 6;
    const height = type === 'plant' ? 20 : type === 'lamp' ? 24 : 12;

    // Top face
    g.poly([
      { x, y: y - height }, { x: x + hw, y: y - height + hh },
      { x, y: y - height + hh * 2 }, { x: x - hw, y: y - height + hh },
    ]);
    g.fill({ color, alpha: 0.9 });
    // Right face
    g.poly([
      { x: x + hw, y: y - height + hh }, { x, y: y - height + hh * 2 },
      { x, y: y + hh * 2 }, { x: x + hw, y: y + hh },
    ]);
    g.fill({ color: (color & 0xfefefe) >> 1, alpha: 0.9 }); // darken safely
    // Left face
    g.poly([
      { x: x - hw, y: y - height + hh }, { x, y: y - height + hh * 2 },
      { x, y: y + hh * 2 }, { x: x - hw, y: y + hh },
    ]);
    g.fill({ color: ((color & 0xfefefe) >> 1) + 0x111111, alpha: 0.9 });
  }

  private setupInteraction(parent: HTMLElement): void {
    let isDragging = false;
    let lastX = 0, lastY = 0;

    parent.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    });
    parent.addEventListener('mousemove', (e) => {
      if (isDragging) {
        this.cameraX += e.clientX - lastX;
        this.cameraY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        this.updateCamera();
      }
    });
    parent.addEventListener('mouseup', () => { isDragging = false; });
    parent.addEventListener('mouseleave', () => { isDragging = false; });
    parent.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(this.zoomLevel + (e.deltaY > 0 ? -0.1 : 0.1));
    }, { passive: false });
  }

  showGrid(layout: OfficeLayout, show: boolean): void {
    const world = this.app.stage.children[0];
    if (!(world instanceof Container)) return;

    const existing = world.getChildByLabel('grid');
    if (existing) { world.removeChild(existing); existing.destroy(); }
    if (!show) return;

    const grid = new Graphics();
    grid.label = 'grid';
    grid.eventMode = 'none';

    for (let gy = 0; gy <= layout.height; gy++) {
      const s = this.gridToScreen(0, gy);
      const e = this.gridToScreen(layout.width, gy);
      grid.moveTo(s.x, s.y); grid.lineTo(e.x, e.y);
      grid.stroke({ color: 0xffffff, width: 1, alpha: 0.2 });
    }
    for (let gx = 0; gx <= layout.width; gx++) {
      const s = this.gridToScreen(gx, 0);
      const e = this.gridToScreen(gx, layout.height);
      grid.moveTo(s.x, s.y); grid.lineTo(e.x, e.y);
      grid.stroke({ color: 0xffffff, width: 1, alpha: 0.2 });
    }
    world.addChild(grid);
  }
}
