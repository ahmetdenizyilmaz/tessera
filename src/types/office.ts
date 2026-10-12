export type WorkerActivity =
  | 'idle' | 'new' | 'thinking' | 'responding' | 'reading_file'
  | 'editing_file' | 'writing_file' | 'running_command' | 'searching_files'
  | 'searching_web' | 'managing_todos' | 'awaiting_permission' | 'error' | 'using_tool' | 'unknown';

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
  itemId?: string;
  /** Automatically supplied equipment is never sellable or packable. */
  workstationFor?: string;
}

export interface OfficeWorker {
  instanceId: string;
  position: { x: number; y: number };
  targetPosition: GridPosition;
  activity: WorkerActivity;
  assignedDesk: GridPosition;
  direction: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  isWalking: boolean;
  task: string;
  detail: string;
  seat?: { furnitureId: string; index: number; position: GridPosition; rotation: number };
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

/** Where a wearable sits on the character. One item per slot. */
export type WearableSlot = 'head' | 'face' | 'neck' | 'shirt';
export const WEARABLE_SLOTS: WearableSlot[] = ['head', 'face', 'neck', 'shirt'];

export interface ShopItem {
  id: string;
  name: string;
  category: 'floor' | 'furniture' | 'decoration' | 'accessory' | 'pc' | 'server';
  price: number;
  sprite: string;
  furnitureType?: OfficeFurnitureType;
  slot?: WearableSlot;
  version?: 1;
  description?: string;
  footprint?: { w: number; h: number };
  collision?: Array<[number, number]>;
  /** Four genuine isometric views in one self-contained definition. */
  art?: [string, string, string, string];
  anchor?: { x: number; y: number };
  foreground?: [string, string, string, string];
  seats?: Array<{ x: number; y: number; approach: [number, number] }>;
  interaction?: Array<[number, number]>;
  bonus?: { scope: 'worker' | 'environment' | 'provider'; amount: number; family?: string; provider?: string };
  pcMultiplier?: number;
  color?: string;
  attachment?: { x: number; y: number; scale: number };
  badgeAnchor?: { x: number; y: number };
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
  unknown: ['reception'],
};

export interface WorkerProfile {
  appearanceId?: string;
  coins: number;
  tasks: number;
  /** Equipped wearable ids by slot. */
  wearables: Partial<Record<WearableSlot, string>>;
  pc?: string;
  activity?: number;
  activityAt?: number;
  activityState?: WorkerActivity;
}
export interface OfficeReward {
  id: string;
  panelId: string;
  name: string;
  task: string;
  coins: number;
  at: number;
  base?: number;
  estimated?: boolean;
}

export interface OfficeRates { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface OfficeSettlement {
  usage: import('./activity').ActivityUsage;
  multiplier: number;
  rates: OfficeRates;
  estimated: boolean;
  panelId: string;
  modelKey: string;
  completed?: boolean;
}
export type OfficeLocation = 'studio' | 'city' | 'plaza' | 'seaside';
