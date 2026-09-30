import type { OfficeWorker, GridPosition, OfficeLayout } from '../types/office';
import { findPath } from './PathFinding';

export interface WorkerPose { x: number; y: number; direction: number; isWalking: boolean }
interface AnimationState { position: WorkerPose; path: GridPosition[]; next: number }
export class WorkerAnimator {
  private states = new Map<string, AnimationState>();
  assignPath(id: string, worker: OfficeWorker, layout: OfficeLayout): void {
    // Re-routing starts at the actual animated position, not the old store tile.
    const position = this.states.get(id)?.position ?? { ...worker.position, direction: worker.direction, isWalking: false };
    const start = { gridX: Math.round(position.x), gridY: Math.round(position.y) };
    const path = findPath(layout, start, worker.targetPosition);
    this.states.set(id, { position: { ...position }, path, next: 0 });
  }
  update(dt: number, workers: Record<string, OfficeWorker>): Map<string, WorkerPose> {
    const result = new Map<string, WorkerPose>();
    for (const [id, worker] of Object.entries(workers)) {
      const state = this.states.get(id);
      if (!state) { result.set(id, { ...worker.position, direction: worker.direction, isWalking: false }); continue; }
      let distance = Math.max(0, dt) * 3;
      while (distance > 0 && state.next < state.path.length) {
        const target = state.path[state.next];
        const dx = target.gridX - state.position.x, dy = target.gridY - state.position.y;
        const remaining = Math.hypot(dx, dy);
        if (remaining <= distance) {
          state.position.x = target.gridX; state.position.y = target.gridY;
          distance -= remaining; state.next++;
        } else {
          state.position.x += dx / remaining * distance; state.position.y += dy / remaining * distance; distance = 0;
        }
        if (remaining > 0) state.position.direction = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 10) % 8;
      }
      state.position.isWalking = state.next < state.path.length;
      result.set(id, { ...state.position });
    }
    return result;
  }
  removeWorker(id: string) { this.states.delete(id); }
}
