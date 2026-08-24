import type { WorkerActivity, OfficeFurnitureType } from '../types/office';
import type { LlmProvider } from '../types/instance';

// Provider color coding
export const PROVIDER_COLORS: Record<LlmProvider, number> = {
  claude: 0xFF8C00,    // orange
  anthropic: 0xD97757, // terracotta
  openai: 0x10A37F,    // green
  openrouter: 0x8B7CF6, // violet
  gemini: 0x4285F4,    // blue
  ollama: 0xCCCCCC,    // light gray
  lmstudio: 0x9B59B6,  // purple
};

// Activity emoji/symbol for indicator
export const ACTIVITY_ICONS: Record<WorkerActivity, string> = {
  idle: 'zzz',
  new: 'star',
  thinking: 'thought',
  responding: 'typing',
  reading_file: 'book',
  editing_file: 'pencil',
  writing_file: 'pen',
  running_command: 'terminal',
  searching_files: 'search',
  searching_web: 'globe',
  managing_todos: 'checklist',
  awaiting_permission: 'lock',
  error: 'warning',
  using_tool: 'wrench',
};

// Activity display names
export const ACTIVITY_LABELS: Record<WorkerActivity, string> = {
  idle: 'Taking a break',
  new: 'Just arrived',
  thinking: 'Thinking...',
  responding: 'Writing response',
  reading_file: 'Reading file',
  editing_file: 'Editing file',
  writing_file: 'Writing file',
  running_command: 'Running command',
  searching_files: 'Searching files',
  searching_web: 'Browsing web',
  managing_todos: 'Managing tasks',
  awaiting_permission: 'Waiting for approval',
  error: 'Error occurred',
  using_tool: 'Using tool',
};

// Furniture dimensions (tile units for pathfinding blocking)
export const FURNITURE_SIZES: Record<OfficeFurnitureType, { w: number; h: number }> = {
  desk: { w: 2, h: 1 },
  chair: { w: 1, h: 1 },
  filing_cabinet: { w: 1, h: 1 },
  whiteboard: { w: 2, h: 1 },
  coffee_machine: { w: 1, h: 1 },
  couch: { w: 2, h: 1 },
  plant: { w: 1, h: 1 },
  bookshelf: { w: 2, h: 1 },
  server_rack: { w: 1, h: 2 },
  printer: { w: 1, h: 1 },
  water_cooler: { w: 1, h: 1 },
  task_board: { w: 2, h: 1 },
  lamp: { w: 1, h: 1 },
  rug: { w: 2, h: 2 },
  poster: { w: 1, h: 1 },
};

export function getProviderColor(provider: LlmProvider): number {
  return PROVIDER_COLORS[provider] ?? 0x888888;
}
