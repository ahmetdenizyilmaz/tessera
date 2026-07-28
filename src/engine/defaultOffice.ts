import type { OfficeLayout, OfficeFurniture, OfficeRoom, GridPosition } from '../types/office';

// Room definitions for the 30x20 grid office
const ROOMS: OfficeRoom[] = [
  // Reception - top-left
  { type: 'reception', bounds: { x: 0, y: 0, w: 8, h: 5 } },
  // Open Floor - main area with desks
  { type: 'open_floor', bounds: { x: 8, y: 0, w: 22, h: 10 } },
  // Manager's Office - left side
  { type: 'manager_office', bounds: { x: 0, y: 5, w: 8, h: 5 } },
  // Meeting Room - bottom-left
  { type: 'meeting_room', bounds: { x: 0, y: 10, w: 8, h: 5 } },
  // Server Room - bottom-center-left
  { type: 'server_room', bounds: { x: 8, y: 10, w: 7, h: 5 } },
  // Break Room - bottom-center-right
  { type: 'break_room', bounds: { x: 15, y: 10, w: 15, h: 5 } },
  // Archive / Library - bottom-far-left
  { type: 'archive', bounds: { x: 0, y: 15, w: 8, h: 5 } },
  // Computer Lab - bottom-center
  { type: 'computer_lab', bounds: { x: 8, y: 15, w: 7, h: 5 } },
  // Maintenance Room - bottom-right
  { type: 'maintenance', bounds: { x: 15, y: 15, w: 15, h: 5 } },
];

// Create desk positions in the open floor area (4 rows of 5 desks)
function createDesks(): OfficeFurniture[] {
  const desks: OfficeFurniture[] = [];
  let id = 0;

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const gx = 10 + col * 4;
      const gy = 1 + row * 2;
      desks.push({
        id: `desk-${id}`,
        type: 'desk',
        position: { gridX: gx, gridY: gy },
        rotation: 0,
      });
      desks.push({
        id: `chair-${id}`,
        type: 'chair',
        position: { gridX: gx, gridY: gy + 1 },
        rotation: 0,
      });
      id++;
    }
  }

  return desks;
}

// Get the list of desk positions for worker assignment
export function getDeskPositions(): GridPosition[] {
  const positions: GridPosition[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      positions.push({ gridX: 10 + col * 4, gridY: 1 + row * 2 });
    }
  }
  return positions;
}

// Precise walkpoints near relevant furniture for each activity
const ACTIVITY_WALKPOINTS: Record<string, GridPosition> = {
  new:                  { gridX: 4, gridY: 3 },    // Reception: near reception desk
  idle:                 { gridX: 22, gridY: 13 },   // Break room: near couches
  thinking:             { gridX: 4, gridY: 12 },    // Meeting room: near whiteboard
  running_command:      { gridX: 10, gridY: 13 },   // Server room: near server racks
  searching_files:      { gridX: 4, gridY: 17 },    // Archive: near filing cabinets
  searching_web:        { gridX: 10, gridY: 17 },   // Computer lab: near desks
  managing_todos:       { gridX: 27, gridY: 3 },    // Open floor: near task board
  awaiting_permission:  { gridX: 4, gridY: 8 },     // Manager's office: near manager desk
  error:                { gridX: 22, gridY: 17 },   // Maintenance: near tools
};

// Get a location inside a room for a given activity
export function getActivityLocation(activity: string, _rooms: OfficeRoom[]): GridPosition {
  return ACTIVITY_WALKPOINTS[activity] ?? { gridX: 15, gridY: 5 };
}

function createRoomFurniture(): OfficeFurniture[] {
  const furniture: OfficeFurniture[] = [];

  // Reception
  furniture.push(
    { id: 'reception-desk', type: 'desk', position: { gridX: 3, gridY: 2 }, rotation: 0 },
    { id: 'reception-plant1', type: 'plant', position: { gridX: 1, gridY: 1 }, rotation: 0 },
    { id: 'reception-plant2', type: 'plant', position: { gridX: 6, gridY: 1 }, rotation: 0 },
  );

  // Manager's Office
  furniture.push(
    { id: 'manager-desk', type: 'desk', position: { gridX: 3, gridY: 7 }, rotation: 0 },
    { id: 'manager-chair', type: 'chair', position: { gridX: 3, gridY: 8 }, rotation: 0 },
    { id: 'manager-bookshelf', type: 'bookshelf', position: { gridX: 1, gridY: 6 }, rotation: 0 },
    { id: 'manager-plant', type: 'plant', position: { gridX: 6, gridY: 6 }, rotation: 0 },
  );

  // Meeting Room
  furniture.push(
    { id: 'meeting-whiteboard', type: 'whiteboard', position: { gridX: 3, gridY: 11 }, rotation: 0 },
    { id: 'meeting-desk', type: 'desk', position: { gridX: 3, gridY: 13 }, rotation: 0 },
  );

  // Server Room
  furniture.push(
    { id: 'server-rack1', type: 'server_rack', position: { gridX: 9, gridY: 11 }, rotation: 0 },
    { id: 'server-rack2', type: 'server_rack', position: { gridX: 11, gridY: 11 }, rotation: 0 },
    { id: 'server-rack3', type: 'server_rack', position: { gridX: 13, gridY: 11 }, rotation: 0 },
  );

  // Break Room
  furniture.push(
    { id: 'break-coffee', type: 'coffee_machine', position: { gridX: 16, gridY: 11 }, rotation: 0 },
    { id: 'break-couch1', type: 'couch', position: { gridX: 20, gridY: 12 }, rotation: 0 },
    { id: 'break-couch2', type: 'couch', position: { gridX: 24, gridY: 12 }, rotation: 0 },
    { id: 'break-water', type: 'water_cooler', position: { gridX: 28, gridY: 11 }, rotation: 0 },
    { id: 'break-plant', type: 'plant', position: { gridX: 16, gridY: 13 }, rotation: 0 },
  );

  // Archive
  furniture.push(
    { id: 'archive-shelf1', type: 'bookshelf', position: { gridX: 1, gridY: 16 }, rotation: 0 },
    { id: 'archive-shelf2', type: 'bookshelf', position: { gridX: 1, gridY: 18 }, rotation: 0 },
    { id: 'archive-cabinet1', type: 'filing_cabinet', position: { gridX: 5, gridY: 16 }, rotation: 0 },
    { id: 'archive-cabinet2', type: 'filing_cabinet', position: { gridX: 5, gridY: 18 }, rotation: 0 },
  );

  // Computer Lab
  furniture.push(
    { id: 'lab-desk1', type: 'desk', position: { gridX: 9, gridY: 16 }, rotation: 0 },
    { id: 'lab-desk2', type: 'desk', position: { gridX: 9, gridY: 18 }, rotation: 0 },
    { id: 'lab-chair1', type: 'chair', position: { gridX: 9, gridY: 17 }, rotation: 0 },
    { id: 'lab-chair2', type: 'chair', position: { gridX: 9, gridY: 19 }, rotation: 0 },
  );

  // Maintenance Room
  furniture.push(
    { id: 'maint-rack', type: 'server_rack', position: { gridX: 20, gridY: 16 }, rotation: 0 },
    { id: 'maint-lamp', type: 'lamp', position: { gridX: 24, gridY: 16 }, rotation: 0 },
  );

  // Open Floor extras
  furniture.push(
    { id: 'floor-taskboard', type: 'task_board', position: { gridX: 28, gridY: 2 }, rotation: 0 },
    { id: 'floor-printer', type: 'printer', position: { gridX: 28, gridY: 5 }, rotation: 0 },
    { id: 'floor-plant1', type: 'plant', position: { gridX: 9, gridY: 1 }, rotation: 0 },
    { id: 'floor-plant2', type: 'plant', position: { gridX: 9, gridY: 9 }, rotation: 0 },
  );

  return furniture;
}

// Build floor tile style map based on room types
function createFloorTiles(width: number, height: number, rooms: OfficeRoom[]): Record<string, string> {
  const tiles: Record<string, string> = {};

  // Default all tiles
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[`${x},${y}`] = 'default';
    }
  }

  // Overlay room floor styles
  const roomStyles: Record<string, string> = {
    reception: 'marble',
    open_floor: 'carpet',
    manager_office: 'wood',
    meeting_room: 'meeting',
    server_room: 'server',
    break_room: 'break_room',
    archive: 'archive',
    computer_lab: 'computer_lab',
    maintenance: 'maintenance',
  };

  for (const room of rooms) {
    const style = roomStyles[room.type] ?? 'default';
    for (let y = room.bounds.y; y < room.bounds.y + room.bounds.h; y++) {
      for (let x = room.bounds.x; x < room.bounds.x + room.bounds.w; x++) {
        tiles[`${x},${y}`] = style;
      }
    }
  }

  return tiles;
}

export function getDefaultLayout(): OfficeLayout {
  const width = 30;
  const height = 20;

  return {
    width,
    height,
    floorTiles: createFloorTiles(width, height, ROOMS),
    wallTiles: {},
    furniture: [...createDesks(), ...createRoomFurniture()],
    rooms: ROOMS,
  };
}
