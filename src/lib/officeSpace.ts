import type { GridPosition, OfficeFurniture, OfficeLayout, OfficeWorker, WorkerActivity } from '../types/office';
import { FURNITURE_SIZES } from '../engine/SpriteManager';
import { itemForFurniture } from './officeCatalog';

export function furnitureCells(f: OfficeFurniture): GridPosition[] {
  const size = itemForFurniture(f)?.footprint ?? FURNITURE_SIZES[f.type];
  const w = f.rotation % 2 ? size.h : size.w, h = f.rotation % 2 ? size.w : size.h;
  return Array.from({ length: w * h }, (_, i) => ({ gridX: f.position.gridX + i % w, gridY: f.position.gridY + Math.floor(i / w) }));
}
export const insideOffice = (layout: OfficeLayout, p: GridPosition) => Number.isInteger(p.gridX) && Number.isInteger(p.gridY) && p.gridX >= 0 && p.gridY >= 0 && p.gridX < layout.width && p.gridY < layout.height;
export function blockedCells(layout: OfficeLayout): Set<string> {
  return new Set(layout.furniture.flatMap(f => collisionCells(f).map(p => `${p.gridX},${p.gridY}`)));
}
export function rotatePoint(f: OfficeFurniture, x: number, y: number): GridPosition {
  const { w,h } = itemForFurniture(f)?.footprint ?? FURNITURE_SIZES[f.type];
  const [a,b] = [[x,y],[h-y,x],[w-x,h-y],[y,w-x]][f.rotation];
  return { gridX: f.position.gridX+a, gridY: f.position.gridY+b };
}
export function collisionCells(f: OfficeFurniture): GridPosition[] {
  const item = itemForFurniture(f);
  if (!item?.collision) return ['rug','poster'].includes(f.type) ? [] : furnitureCells(f);
  return item.collision.map(([x,y]) => { const p = rotatePoint(f,x+.5,y+.5); return { gridX: Math.floor(p.gridX), gridY: Math.floor(p.gridY) }; });
}
export function interactionTile(f: OfficeFurniture): GridPosition {
  const [x,y] = itemForFurniture(f)?.interaction?.[0] ?? [0,1];
  const p = rotatePoint(f,x+.5,y+.5);
  return { gridX: Math.floor(p.gridX), gridY: Math.floor(p.gridY) };
}
export function seatsIn(layout: OfficeLayout) {
  return layout.furniture.flatMap(f => (itemForFurniture(f)?.seats ?? []).map((s,index) => {
    const a = rotatePoint(f,s.approach[0]+.5,s.approach[1]+.5);
    return { furnitureId: f.id, index, position: rotatePoint(f,s.x,s.y), rotation: f.rotation,
      approach: { gridX: Math.floor(a.gridX), gridY: Math.floor(a.gridY) } };
  }));
}
/** Flood-fill access: furniture may not split the walkable floor into islands. */
export function connectedFloor(layout: OfficeLayout) {
  const blocked = blockedCells(layout), seen = new Set<string>(), queue: GridPosition[] = [];
  for (let y=0;y<layout.height && !queue.length;y++) for (let x=0;x<layout.width;x++) if (!blocked.has(`${x},${y}`)) { queue.push({gridX:x,gridY:y}); break; }
  if (!queue.length) return false;
  seen.add(`${queue[0].gridX},${queue[0].gridY}`);
  for (let n=0;n<queue.length;n++) for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const p = {gridX:queue[n].gridX+dx,gridY:queue[n].gridY+dy}, key = `${p.gridX},${p.gridY}`;
    if (insideOffice(layout,p) && !blocked.has(key) && !seen.has(key)) {seen.add(key);queue.push(p);}
  }
  return seen.size === layout.width*layout.height - blocked.size;
}
export function placementError(layout: OfficeLayout, furniture: OfficeFurniture, workers: Record<string, OfficeWorker>): string | null {
  const cells = furnitureCells(furniture);
  if (cells.some(p => !insideOffice(layout, p))) return 'Keep the whole item inside the office.';
  const isFloor = (f: OfficeFurniture) => ['rug','poster'].includes(f.type);
  const occupied = new Set(layout.furniture.filter(f => f.id !== furniture.id && isFloor(f) === isFloor(furniture)).flatMap(f => furnitureCells(f).map(p => `${p.gridX},${p.gridY}`)));
  if (cells.some(p => occupied.has(`${p.gridX},${p.gridY}`))) return 'That spot is occupied. Choose an empty tile.';
  if (!isFloor(furniture) && cells.some(p => Object.values(workers).some(w =>
    (Math.round(w.position.x) === p.gridX && Math.round(w.position.y) === p.gridY) ||
    (w.targetPosition.gridX === p.gridX && w.targetPosition.gridY === p.gridY)))) return 'An agent is using that spot. Choose another tile.';
  const next = {...layout, furniture:[...layout.furniture.filter(f => f.id !== furniture.id), furniture]};
  const blocked = blockedCells(next);
  if (next.furniture.some(f => f.workstationFor && (f.type === 'desk') && (!insideOffice(next,interactionTile(f)) || blocked.has(`${interactionTile(f).gridX},${interactionTile(f).gridY}`)))) return 'Keep the workstation approach clear.';
  if (!connectedFloor(next)) return 'Leave a connected walking route through the office.';
  if (seatsIn(next).some(s => !insideOffice(next,s.approach) || blocked.has(`${s.approach.gridX},${s.approach.gridY}`))) return 'Leave space in front of every seat.';
  return null;
}

export function expandOffice(layout: OfficeLayout): OfficeLayout {
  const y = layout.height, floorTiles = {...layout.floorTiles};
  for (let row=y;row<y+4;row++) for (let x=0;x<layout.width;x++) floorTiles[`${x},${row}`]='carpet';
  return {...layout,height:y+4,floorTiles,rooms:[...layout.rooms,{type:'open_floor',bounds:{x:0,y,w:layout.width,h:4}}]};
}
/** Append-only capacity growth keeps the user's furniture and room positions intact. */
export function ensureWorkstations(layout: OfficeLayout, ids: string[]): OfficeLayout {
  let next = layout;
  let furniture = layout.furniture.map(f => f.workstationFor && !ids.includes(f.workstationFor) ? {...f,workstationFor:undefined} : f);
  let changed = furniture.some((f,i) => f !== layout.furniture[i]);
  for (const id of ids) {
    if (furniture.some(f => f.type === 'desk' && f.workstationFor === id)) continue;
    const spare = furniture.find(f => f.type === 'desk' && !f.workstationFor && (f.id.startsWith('auto-desk-') || f.id.startsWith('starter-')) && !blockedCells({...next,furniture}).has(`${interactionTile(f).gridX},${interactionTile(f).gridY}`));
    if (spare) { furniture = furniture.map(f => f===spare ? {...f,workstationFor:id} : f); changed=true; continue; }
    // Allocate in a fresh module if no existing clear 3x3 workstation bay fits.
    let placed = false;
    while (!placed) {
      const blocked = blockedCells({...next,furniture});
      for (let y=1;y<next.height-2 && !placed;y+=3) for (let x=1;x<next.width-3 && !placed;x+=3) {
        const clear = Array.from({length:9},(_,n)=>`${x+n%3},${y+Math.floor(n/3)}`).every(k=>!blocked.has(k));
        if (clear) { furniture.push({id:`auto-desk-${crypto.randomUUID()}`,type:'desk',itemId:'shop-desk-oak',rotation:0,position:{gridX:x,gridY:y},workstationFor:id}); placed=true; changed=true; }
      }
      if (!placed) {next=expandOffice(next);changed=true;}
    }
  }
  return changed ? {...next,furniture} : layout;
}

export const STATION_LABELS: Record<WorkerActivity, string> = {
  new: 'Reception', unknown: 'Reception', idle: 'Coffee lounge', thinking: 'Planning room',
  responding: 'Workstation', editing_file: 'Workstation', writing_file: 'Workstation', using_tool: 'Workstation',
  reading_file: 'Library', searching_files: 'Library', running_command: 'Build lab', searching_web: 'Research lab',
  managing_todos: 'Planning room', awaiting_permission: 'Your office', error: 'Support desk',
};
const ROOM_FOR: Partial<Record<WorkerActivity, string>> = {
  new: 'reception', unknown: 'reception', idle: 'break_room', thinking: 'meeting_room', managing_todos: 'meeting_room',
  reading_file: 'archive', searching_files: 'archive', running_command: 'server_room', searching_web: 'computer_lab',
  awaiting_permission: 'manager_office', error: 'maintenance',
};
export function workerDestination(layout: OfficeLayout, activity: WorkerActivity, index: number, occupied: Set<string> = new Set()): GridPosition {
  const roomType = ROOM_FOR[activity] ?? 'open_floor';
  const room = layout.rooms.find(r => r.type === roomType);
  const blocked = blockedCells(layout);
  const b = room?.bounds ?? { x: 0, y: 0, w: layout.width, h: layout.height };
  const candidates: GridPosition[] = [];
  // Walk to a free tile near a station, never into the furniture itself.
  for (let y = b.y + 1; y < b.y + b.h; y++) for (let x = b.x + 1; x < b.x + b.w; x++) {
    if (!blocked.has(`${x},${y}`) && !occupied.has(`${x},${y}`)) candidates.push({ gridX: x, gridY: y });
  }
  if (candidates.length) {
    const stationTypes: Record<string, string[]> = {
      open_floor: ['desk'], break_room: ['coffee_machine', 'couch'], archive: ['bookshelf', 'filing_cabinet'],
      meeting_room: ['whiteboard', 'task_board'], server_room: ['server_rack'], computer_lab: ['desk'],
      manager_office: ['desk'], maintenance: ['printer', 'server_rack'], reception: ['desk'],
    };
    const stations = layout.furniture.filter(f => stationTypes[roomType]?.includes(f.type) && f.position.gridX >= b.x && f.position.gridX < b.x + b.w && f.position.gridY >= b.y && f.position.gridY < b.y + b.h);
    const station = stations[index % stations.length];
    if (station) {
      const anchor = { x: station.position.gridX + 1, y: station.position.gridY + 1 };
      candidates.sort((a, b) => (Math.abs(a.gridX - anchor.x) + Math.abs(a.gridY - anchor.y)) - (Math.abs(b.gridX - anchor.x) + Math.abs(b.gridY - anchor.y)));
      return candidates[0];
    }
    return candidates[(index * 3) % candidates.length];
  }
  for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
    if (!blocked.has(`${x},${y}`) && !occupied.has(`${x},${y}`)) return { gridX: x, gridY: y };
  }
  return { gridX: 0, gridY: 0 };
}
