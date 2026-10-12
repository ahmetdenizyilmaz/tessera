import type { WorkerActivity } from '../types/office';

/** Working state drives appearance and the bounded activity coefficient; only recorded tokens earn coins. */
export function isWorking(activity: WorkerActivity): boolean {
  return !['idle', 'new', 'unknown', 'error', 'awaiting_permission'].includes(activity);
}
