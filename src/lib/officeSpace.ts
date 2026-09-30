import type { GridPosition, OfficeFurniture, OfficeLayout, OfficeWorker, WorkerActivity } from '../types/office';
import { FURNITURE_SIZES } from '../engine/SpriteManager';

export function furnitureCells(f: OfficeFurniture): GridPosition[] {
  const size = FURNITURE_SIZES[f.type];
  const w = f.rotation % 2 ? size.h : size.w, h = f.rotation % 2 ? size.w : size.h;
  return Array.from({ length: w * h }, (_, i) => ({ gridX: f.position.gridX + i % w, gridY: f.position.gridY + Math.floor(i / w) }));
}
export const insideOffice = (layout: OfficeLayout, p: GridPosition) => Number.isInteger(p.gridX) && Number.isInteger(p.gridY) && p.gridX >= 0 && p.gridY >= 0 && p.gridX < layout.width && p.gridY < layout.height;
export function blockedCells(layout: OfficeLayout): Set<string> {
  return new Set(layout.furniture.filter(f => f.type !== 'rug' && f.type !== 'poster').flatMap(f => furnitureCells(f).map(p => `${p.gridX},${p.gridY}`)));
}
export function placementError(layout: OfficeLayout, furniture: OfficeFurniture, workers: Record<string, OfficeWorker>): string | null {
  const cells = furnitureCells(furniture);
  if (cells.some(p => !insideOffice(layout, p))) return 'Keep the whole item inside the office.';
  const occupied = new Set(layout.furniture.filter(f => f.id !== furniture.id).flatMap(f => furnitureCells(f).map(p => `${p.gridX},${p.gridY}`)));
  if (cells.some(p => occupied.has(`${p.gridX},${p.gridY}`))) return 'That spot is occupied. Choose an empty tile.';
  if (cells.some(p => Object.values(workers).some(w =>
    (Math.round(w.position.x) === p.gridX && Math.round(w.position.y) === p.gridY) ||
    (w.targetPosition.gridX === p.gridX && w.targetPosition.gridY === p.gridY)))) return 'An agent is using that spot. Choose another tile.';
  return null;
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
