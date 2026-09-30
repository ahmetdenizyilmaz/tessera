import type { WorkerActivity } from '../types/office';

/** Coins come from confirmed completed turns, never elapsed time or token spend. */
export function isWorking(activity: WorkerActivity): boolean {
  return !['idle', 'new', 'unknown', 'error', 'awaiting_permission'].includes(activity);
}
