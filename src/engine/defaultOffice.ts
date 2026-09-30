import type { OfficeLayout, OfficeFurniture, OfficeRoom } from '../types/office';

export function getDefaultLayout(): OfficeLayout {
  const rooms: OfficeRoom[] = [
    { type: 'reception', bounds: { x: 0, y: 0, w: 6, h: 4 } },
    { type: 'open_floor', bounds: { x: 6, y: 0, w: 16, h: 8 } },
    { type: 'manager_office', bounds: { x: 0, y: 4, w: 6, h: 4 } },
    { type: 'meeting_room', bounds: { x: 0, y: 8, w: 6, h: 4 } },
    { type: 'server_room', bounds: { x: 6, y: 8, w: 6, h: 4 } },
    { type: 'break_room', bounds: { x: 12, y: 8, w: 10, h: 4 } },
    { type: 'archive', bounds: { x: 0, y: 12, w: 6, h: 4 } },
    { type: 'computer_lab', bounds: { x: 6, y: 12, w: 6, h: 4 } },
    { type: 'maintenance', bounds: { x: 12, y: 12, w: 10, h: 4 } },
  ];
  const floorTiles: Record<string, string> = {};
  const styles: Record<string, string> = { reception: 'marble', open_floor: 'carpet', manager_office: 'wood', meeting_room: 'meeting', server_room: 'server', break_room: 'break_room', archive: 'archive', computer_lab: 'computer_lab', maintenance: 'maintenance' };
  for (const r of rooms) for (let y = r.bounds.y; y < r.bounds.y + r.bounds.h; y++) for (let x = r.bounds.x; x < r.bounds.x + r.bounds.w; x++) floorTiles[`${x},${y}`] = styles[r.type];
  const furniture: OfficeFurniture[] = [];
  const add = (type: OfficeFurniture['type'], x: number, y: number) => furniture.push({ id: `starter-${type}-${x}-${y}`, type, position: { gridX: x, gridY: y }, rotation: 0 });
  add('desk', 2, 1); add('plant', 0, 2); add('plant', 5, 0);
  for (const [x, y] of [[8, 1], [13, 1], [8, 5], [13, 5]]) { add('desk', x, y); add('chair', x, y + 1); }
  add('plant', 20, 1); add('task_board', 18, 5);
  add('desk', 1, 5); add('plant', 4, 5);
  add('whiteboard', 1, 9); add('plant', 4, 10);
  add('server_rack', 7, 9); add('server_rack', 10, 9);
  add('coffee_machine', 13, 9); add('couch', 16, 9); add('plant', 20, 10);
  add('bookshelf', 1, 13); add('filing_cabinet', 4, 14);
  add('desk', 7, 13); add('chair', 7, 14);
  add('lamp', 14, 13); add('printer', 17, 13);
  return { width: 22, height: 16, rooms, furniture, floorTiles, wallTiles: {} };
}
