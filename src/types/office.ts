export type WorkerActivity =
  | 'idle' | 'new' | 'thinking' | 'responding' | 'reading_file'
  | 'editing_file' | 'writing_file' | 'running_command' | 'searching_files'
  | 'searching_web' | 'managing_todos' | 'awaiting_permission' | 'error' | 'using_tool';

export type OfficeFurnitureType =
  | 'desk' | 'chair' | 'filing_cabinet' | 'whiteboard'
  | 'coffee_machine' | 'couch' | 'plant' | 'bookshelf' | 'server_rack'
  | 'printer' | 'water_cooler' | 'task_board' | 'lamp' | 'rug' | 'poster';

export type OfficeRoomType =
  | 'open_floor' | 'server_room' | 'meeting_room' | 'break_room'
  | 'archive' | 'manager_office' | 'computer_lab' | 'reception' | 'maintenance';

export interface GridPosition {
  gridX: number;
  gridY: number;
}

export interface OfficeFurniture {
  id: string;
  type: OfficeFurnitureType;
  position: GridPosition;
  rotation: 0 | 1 | 2 | 3;
  style?: string;
}

export interface OfficeWorker {
  instanceId: string;
  position: { x: number; y: number };
  targetPosition: GridPosition;
  activity: WorkerActivity;
  assignedDesk: GridPosition;
  direction: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  isWalking: boolean;
}

export interface OfficeRoom {
  type: OfficeRoomType;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface OfficeLayout {
  width: number;
  height: number;
  floorTiles: Record<string, string>;
  wallTiles: Record<string, string>;
  furniture: OfficeFurniture[];
  rooms: OfficeRoom[];
}

export interface ShopItem {
  id: string;
  name: string;
  category: 'floor' | 'wall' | 'furniture' | 'decoration' | 'room';
  price: number;
  sprite: string;
  furnitureType?: OfficeFurnitureType;
}

export const ACTIVITY_LOCATIONS: Record<WorkerActivity, OfficeRoomType[]> = {
  idle: ['break_room', 'open_floor'],
  new: ['reception'],
  thinking: ['open_floor', 'meeting_room'],
  responding: ['open_floor'],
  reading_file: ['archive', 'open_floor'],
  editing_file: ['open_floor'],
  writing_file: ['open_floor'],
  running_command: ['server_room'],
  searching_files: ['archive'],
  searching_web: ['computer_lab'],
  managing_todos: ['open_floor'],
  awaiting_permission: ['manager_office'],
  error: ['maintenance', 'open_floor'],
  using_tool: ['open_floor'],
};
