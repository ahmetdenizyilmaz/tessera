import { drawOfficeSvg } from './officeSvg';
import { Application, Container, Graphics, Matrix, Rectangle, Text } from 'pixi.js';
import type { OfficeLayout, OfficeFurniture, OfficeLocation, WorkerProfile } from '../types/office';
import { BUBBLE_FRAMES, drawOfficeCharacter, drawOfficeFurniture, drawSpeechBubble, type BubbleKind, type CharacterMood } from './officeArt';
import { itemForFurniture, officeItem } from '../lib/officeCatalog';
import { furnitureCells } from '../lib/officeSpace';
import type { WorkerPose } from './WorkerAnimator';

const ROOM_NAMES: Record<string, string> = { reception: 'WELCOME', open_floor: 'THE STUDIO', manager_office: 'YOUR OFFICE', meeting_room: 'PLANNING', server_room: 'BUILD LAB', break_room: 'COFFEE LOUNGE', archive: 'LIBRARY', computer_lab: 'RESEARCH', maintenance: 'SUPPORT' };
export class IsometricEngine {
  app = new Application();
  private world = new Container();
  private exterior = new Graphics();
  private floor = new Container();
  private walls = new Container();
  private entities = new Container();
  private labels = new Container();
  private links = new Graphics();
  private bubbles = new Container();
  private grid = new Graphics();
  private ghost = new Graphics();
  private ghostArt = new Graphics();
  private furnitureHover = new Graphics();
  private hoveredFurniture: string | null = null;
  private heldFurniture: string | null = null;
  private furnitureGraphics = new Map<string,Graphics>();
  private furnitureProfiles: Record<string, WorkerProfile> = {};
  private hoverTile?: {gx:number;gy:number};
  private onTileHoverHandler?: (gx:number,gy:number)=>void;
  private onFurnitureDoubleClickHandler?: (id:string)=>void;
  private placementControls?: { holding:()=>boolean; rotate:(direction:number)=>void; storageAt:(x:number,y:number)=>boolean; storageHover:(hovered:boolean)=>void; store:()=>void };
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
    this.world.addChild(this.exterior, this.floor, this.walls, this.furnitureHover, this.entities, this.links, this.labels, this.bubbles, this.grid, this.ghost, this.ghostArt);
    this.app.stage.addChild(this.world);
    this.entities.sortableChildren = true;
    this.exterior.eventMode='none';this.ghostArt.eventMode='none';this.furnitureHover.eventMode='none';
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
  drawExterior(layout:OfficeLayout, location:OfficeLocation) {
    const g=this.exterior;g.clear();
    const colors={studio:0x354a47,city:0x3b4d50,plaza:0x4b606e,seaside:0x407e90};
    const x=-layout.height*32-180,y=-110,w=(layout.width+layout.height)*32+360,h=(layout.width+layout.height)*16+280;
    g.roundRect(x,y,w,h,40).fill(colors[location]);
    if(location==='seaside') {
      g.roundRect(x+15,y+15,w-30,h-30,32).fill(0x4c96a6);
      for(let row=0;row<12;row++) for(let col=0;col<12;col++) g.moveTo(x+30+col*110,y+30+row*65).quadraticCurveTo(x+55+col*110,y+18+row*65,x+85+col*110,y+30+row*65).stroke({color:0xb0e4dd,alpha:.24,width:2});
      const a=this.gridToScreen(-1,-1),b=this.gridToScreen(layout.width+1,-1),c=this.gridToScreen(layout.width+1,layout.height+1),d=this.gridToScreen(-1,layout.height+1);
      g.poly([a,b,c,d]).fill(0xd7c69c);
    } else {
      for(let i=0;i<6;i++) {
        const bx=x+50+i*w/6;
        if(location==='studio' || location==='city') {g.circle(bx,y+45,20).fill(0x64856c);g.circle(bx+9,y+40,12).fill(0x7c9b7b);}
        else {g.rect(bx,y+15,70,80).fill(0x728b9d);for(let n=0;n<4;n++)g.rect(bx+8+n*15,y+25,6,57).fill(0xa3bcc5);}
      }
    }
  }
  drawFurniture(furniture: OfficeFurniture[], profiles:Record<string,WorkerProfile> = {}) {
    this.furnitureProfiles = profiles;
    for (const child of [...this.entities.children]) if (child.label === 'furniture') { this.entities.removeChild(child); child.destroy({ children: true }); }
    this.furnitureGraphics.clear();
    for (const f of furniture) {
      const g = new Graphics(); g.label = 'furniture'; g.eventMode = 'none';
      const item=f.workstationFor ? officeItem(profiles[f.workstationFor]?.pc ?? 'pc-0') : itemForFurniture(f);
      if(item?.art) {g.save();g.context.translate(-item.anchor!.x,-item.anchor!.y);drawOfficeSvg(g,item.art[f.rotation]);g.restore();}
      else drawOfficeFurniture(g,f.type);
      const p = this.gridToScreen(f.position.gridX, f.position.gridY);
      g.position.set(p.x,p.y);
      g.zIndex = f.type === 'rug' ? -10000 : p.y + ((item?.footprint?.w??1)+(item?.footprint?.h??1))*16-1;
      this.entities.addChild(g);this.furnitureGraphics.set(f.id,g);
    }
    this.updateFurnitureFeedback();
  }
  private updateFurnitureFeedback() {
    this.furnitureHover.clear();
    for(const [id,g] of this.furnitureGraphics) {
      const f=this.layout?.furniture.find(f=>f.id===id);if(!f)continue;
      const hovered=id===this.hoveredFurniture && !this.heldFurniture;
      g.alpha=id===this.heldFurniture ? .25 : 1;
      g.tint=hovered?0xdffff0:0xffffff;
      g.y=this.gridToScreen(f.position.gridX,f.position.gridY).y-(hovered?1.5:0);
      if(hovered) for(const cell of furnitureCells(f)) {
        const p=this.gridToScreen(cell.gridX,cell.gridY);
        this.furnitureHover.poly([p.x,p.y,p.x+32,p.y+16,p.x,p.y+32,p.x-32,p.y+16]).fill({color:0xc5e5d5,alpha:.18}).stroke({color:0xd8f2de,width:1.2,alpha:.7});
      }
    }
  }
  showPlacement(f?:OfficeFurniture, error?:string|null) {
    this.ghost.clear();this.ghostArt.clear();
    this.heldFurniture=f?.id??null;this.updateFurnitureFeedback();
    if(!f) return;
    const color=error ? 0xe38f86 : 0x9ed9b3;
    for(const cell of furnitureCells(f)) {const p=this.gridToScreen(cell.gridX,cell.gridY);this.ghost.poly([p.x,p.y,p.x+32,p.y+16,p.x,p.y+32,p.x-32,p.y+16]).fill({color,alpha:.28}).stroke({color,width:1.5});}
    const item=f.workstationFor ? officeItem(this.furnitureProfiles[f.workstationFor]?.pc ?? 'pc-0') : itemForFurniture(f);
    const p=this.gridToScreen(f.position.gridX,f.position.gridY);
    this.ghostArt.position.set(p.x,p.y);this.ghostArt.alpha=.55;
    if(item?.art) {this.ghostArt.save();this.ghostArt.context.translate(-item.anchor!.x,-item.anchor!.y);drawOfficeSvg(this.ghostArt,item.art[f.rotation]);this.ghostArt.restore();}
    else drawOfficeFurniture(this.ghostArt,f.type);
  }
  refreshPlacement() {if(this.hoverTile)this.onTileHoverHandler?.(this.hoverTile.gx,this.hoverTile.gy);}
  highlightWorker(id:string|null) {for(const [key,w] of this.workerGraphics) {w.label.alpha=key===id?1:.42;w.label.style.fontSize=key===id?12:10;}}
  syncWorkers(ids: string[]) {
    for (const [id, worker] of this.workerGraphics) if (!ids.includes(id)) { worker.body.destroy(); worker.label.destroy(); worker.bubble.destroy(); worker.glyph.destroy(); this.workerGraphics.delete(id); }
    for (const id of ids) if (!this.workerGraphics.has(id)) {
      const body = new Graphics(); body.eventMode = 'static'; body.cursor = 'pointer'; body.hitArea = new Rectangle(-17, -55, 34, 65);
      body.on('pointerover', e => { if (!this.edit) this.onWorkerHoverHandler?.(id, e.global.x, e.global.y); });
      body.on('pointerout', () => this.onWorkerHoverHandler?.(null, 0, 0));
      const label = new Text({ text: '', style: { fontFamily: 'Segoe UI, sans-serif', fontSize: 10, fontWeight: '600', fill: 0xf4f3df, stroke: { color: 0x1b3034, width: 3 }, align: 'center' } });
      label.alpha=.42;label.anchor.set(.5, 0); label.eventMode = 'none';
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
      const p = pos.seat ? this.gridToScreen(pos.seat.position.gridX,pos.seat.position.gridY) : this.gridToScreen(pos.x + .5, pos.y + .5);
      if(pos.seat) p.y-=10;
      w.body.position.set(p.x, p.y); w.body.zIndex = pos.seat ? (this.furnitureGraphics.get(pos.seat.furnitureId)?.zIndex ?? p.y)+1 : p.y;
      w.label.position.set(p.x, p.y + 10);
      w.bubble.position.set(p.x, p.y); w.glyph.position.set(p.x, p.y - 72);
    }
  }
  updateWorkerGraphic(id: string, color: number, activity: string, name: string, provider = '', wearables = '', walking = false, frame = 0, appearanceId = id, mood: CharacterMood = '', seated=false) {
    const w = this.workerGraphics.get(id); if (!w) return;
    const key = [color, activity, name, provider, wearables, walking, seated, walking ? frame % 2 : 0, appearanceId, walking ? '' : mood].join(':');
    if (key === w.key) return;
    w.key = key; drawOfficeCharacter(w.body, appearanceId, color, wearables, frame, walking, activity, walking ? '' : mood, provider, seated);
    w.label.text = name.length > 16 ? name.slice(0, 15) + '…' : name;
  }
  /** The bubble over a character: animated dots while it works, a glyph when it needs
   * someone, a tinted bubble while it is messaging another agent. */
  updateWorkerBubble(id: string, kind: BubbleKind, frame = 0) {
    const w = this.workerGraphics.get(id); if (!w) return;
    const key = kind ? `${kind}:${frame % BUBBLE_FRAMES[kind]}` : '';
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
    this.edit = enabled; this.grid.clear(); this.ghost.clear();this.ghostArt.clear();
    if (!enabled) {
      this.showPlacement();
      const parent = this.app.canvas?.parentElement;
      if (parent) parent.style.cursor = '';
    }
    if (!enabled) return;
    for (let y = 0; y <= layout.height; y++) { const a = this.gridToScreen(0, y), b = this.gridToScreen(layout.width, y); this.grid.moveTo(a.x, a.y).lineTo(b.x, b.y); }
    for (let x = 0; x <= layout.width; x++) { const a = this.gridToScreen(x, 0), b = this.gridToScreen(x, layout.height); this.grid.moveTo(a.x, a.y).lineTo(b.x, b.y); }
    this.grid.stroke({ color: 0xffffff, alpha: .25, width: 1 });
  }
  onTileHover(handler:(gx:number,gy:number)=>void) {this.onTileHoverHandler=handler;}
  onFurnitureDoubleClick(handler:(id:string)=>void) {this.onFurnitureDoubleClickHandler=handler;}
  setPlacementControls(controls:NonNullable<IsometricEngine['placementControls']>) {this.placementControls=controls;}
  private setupInteraction(parent: HTMLElement) {
    let dragging = false, downX = 0, downY = 0, lastX = 0, lastY = 0, panning = false, moved = false, heldOnDown=false, pointerId=-1, lastRotate=0;
    let pressedWorker: string | undefined;
    const workerAt = (e: PointerEvent) => {
      const r = parent.getBoundingClientRect();
      const x = (e.clientX - r.left - this.cameraX) / this.zoomLevel, y = (e.clientY - r.top - this.cameraY) / this.zoomLevel;
      // Match the sprite hit area and the renderer's front-to-back ordering.
      return [...this.workerGraphics].sort((a, b) => b[1].body.zIndex - a[1].body.zIndex)
        .find(([, { body }]) => body.hitArea?.contains(x - body.x, y - body.y))?.[0];
    };
    const point = (e: MouseEvent) => { const r = parent.getBoundingClientRect(); return this.screenToGrid((e.clientX - r.left - this.cameraX) / this.zoomLevel, (e.clientY - r.top - this.cameraY) / this.zoomLevel); };
    const overCanvas=(e:MouseEvent)=>parent.contains(document.elementFromPoint(e.clientX,e.clientY));
    const furnitureAt=(e:MouseEvent)=>{
      const r=parent.getBoundingClientRect(), x=(e.clientX-r.left-this.cameraX)/this.zoomLevel,y=(e.clientY-r.top-this.cameraY)/this.zoomLevel;
      return [...this.furnitureGraphics].sort((a,b)=>b[1].zIndex-a[1].zIndex).find(([,g])=>g.containsPoint({x:x-g.x,y:y-g.y}))?.[0];
    };
    const down = (e: PointerEvent) => { if (e.button > 1) return; dragging = true; pointerId=e.pointerId; heldOnDown=!!this.placementControls?.holding(); moved = e.shiftKey || e.button !== 0; pressedWorker = workerAt(e); panning = e.shiftKey || e.button === 1 || !this.edit; downX = lastX = e.clientX; downY = lastY = e.clientY; parent.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if(dragging && e.pointerId!==pointerId)return;
      if (dragging && Math.hypot(e.clientX - downX, e.clientY - downY) >= 5) moved = true;
      if (dragging && panning) { this.cameraX += e.clientX - lastX; this.cameraY += e.clientY - lastY; this.updateCamera(); }
      lastX = e.clientX; lastY = e.clientY;
      const over=overCanvas(e), holding=!!this.placementControls?.holding();
      this.placementControls?.storageHover(holding && this.placementControls.storageAt(e.clientX,e.clientY));
      const hovered=over && !holding && !workerAt(e) && !dragging ? furnitureAt(e)??null : null;
      if(hovered!==this.hoveredFurniture){this.hoveredFurniture=hovered;this.updateFurnitureFeedback();}
      parent.style.cursor=holding?'grabbing':hovered?'grab':this.edit?'crosshair':'';
      if(this.edit && over) {this.hoverTile=point(e);this.onTileHoverHandler?.(this.hoverTile.gx,this.hoverTile.gy);}
      else {this.hoverTile=undefined;this.ghost.clear();this.ghostArt.clear();}
    };
    const up = (e: PointerEvent) => {
      if(!dragging || e.pointerId!==pointerId)return;
      if (e.button === 0 && (!moved || heldOnDown) && !panning) {
        if(heldOnDown && this.placementControls?.storageAt(e.clientX,e.clientY)) this.placementControls.store();
        else if (this.edit && overCanvas(e)) { const { gx, gy } = point(e); this.onTileClickHandler?.(gx, gy); }
      } else if (!this.edit && !moved && e.button===0 && overCanvas(e)) {
          const worker = workerAt(e);
          if (worker && worker === pressedWorker) this.onWorkerClickHandler?.(worker);
          else if (!worker && !pressedWorker) this.onBackgroundClickHandler?.();
      }
      dragging = false;this.placementControls?.storageHover(false);
      if(parent.hasPointerCapture(e.pointerId))parent.releasePointerCapture(e.pointerId);
    };
    const leave = () => {if(!dragging){this.hoverTile=undefined;this.ghost.clear();this.ghostArt.clear();}this.onWorkerHoverHandler?.(null,0,0);};
    const cancel = () => {dragging=false;this.placementControls?.storageHover(false);leave();};
    const wheel = (e: WheelEvent) => {
      e.preventDefault();if(!e.deltaY)return;
      if(this.placementControls?.holding()) {const now=performance.now();if(now-lastRotate>100){lastRotate=now;this.placementControls.rotate(e.deltaY>0?1:-1);}}
      else this.zoomBy(e.deltaY > 0 ? -.08 : .08);
    };
    const doubleClick=(e:MouseEvent)=>{
      if(this.edit) return;
      const found=furnitureAt(e);
      if(found){e.preventDefault();this.onFurnitureDoubleClickHandler?.(found);}
    };
    parent.addEventListener('dblclick',doubleClick);
    parent.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); parent.addEventListener('pointerleave', leave); parent.addEventListener('pointercancel', cancel); parent.addEventListener('wheel', wheel, { passive: false });
    this.cleanup = () => { parent.removeEventListener('dblclick',doubleClick); parent.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); parent.removeEventListener('pointerleave', leave); parent.removeEventListener('pointercancel', cancel); parent.removeEventListener('wheel', wheel); };
  }
}
