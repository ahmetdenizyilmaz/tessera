import type { OfficeWorker, GridPosition, OfficeLayout } from '../types/office';
import { findPath } from './PathFinding';

const WALK_SPEED = 2; // tiles per second
const BOB_AMPLITUDE = 2; // pixels
const BOB_SPEED = 3; // cycles per second

interface AnimationState {
  path: GridPosition[];
  pathIndex: number;
  progress: number; // 0-1 between current and next path node
  bobPhase: number;
  walkCycle: number;
}

export class WorkerAnimator {
  private states: Map<string, AnimationState> = new Map();
  private lastTime = 0;

  // Call this when a worker gets a new target
  assignPath(instanceId: string, worker: OfficeWorker, layout: OfficeLayout): void {
    const currentGrid: GridPosition = {
      gridX: Math.round(worker.position.x),
      gridY: Math.round(worker.position.y),
    };
    const path = findPath(layout, currentGrid, worker.targetPosition);

    this.states.set(instanceId, {
      path,
      pathIndex: 0,
      progress: 0,
      bobPhase: Math.random() * Math.PI * 2,
      walkCycle: 0,
    });
  }

  // Call each frame. Returns updated positions for all workers.
  update(
    dt: number, // delta time in seconds
    workers: Record<string, OfficeWorker>,
  ): Map<string, { x: number; y: number; direction: number; isWalking: boolean }> {
    const results = new Map<string, { x: number; y: number; direction: number; isWalking: boolean }>();

    for (const [id, worker] of Object.entries(workers)) {
      const state = this.states.get(id);

      if (!state || state.pathIndex >= state.path.length - 1) {
        // Not walking or reached destination
        const bobOffset = worker.activity === 'idle'
          ? Math.sin((state?.bobPhase ?? 0) + performance.now() / 1000 * BOB_SPEED) * BOB_AMPLITUDE / 32
          : 0;

        results.set(id, {
          x: worker.targetPosition.gridX,
          y: worker.targetPosition.gridY + bobOffset / 32,
          direction: worker.direction,
          isWalking: false,
        });
        continue;
      }

      // Walking along path
      state.progress += WALK_SPEED * dt;
      state.walkCycle += dt;

      if (state.progress >= 1) {
        state.progress = 0;
        state.pathIndex++;

        if (state.pathIndex >= state.path.length - 1) {
          // Reached destination
          const dest = state.path[state.path.length - 1];
          results.set(id, {
            x: dest.gridX,
            y: dest.gridY,
            direction: worker.direction,
            isWalking: false,
          });
          continue;
        }
      }

      // Interpolate between current and next path node
      const from = state.path[state.pathIndex];
      const to = state.path[state.pathIndex + 1];
      const t = state.progress;

      const x = from.gridX + (to.gridX - from.gridX) * t;
      const y = from.gridY + (to.gridY - from.gridY) * t;

      // Calculate direction (0=N, 1=NE, 2=E, ... 7=NW)
      const dx = to.gridX - from.gridX;
      const dy = to.gridY - from.gridY;
      const direction = this.calcDirection(dx, dy);

      results.set(id, { x, y, direction, isWalking: true });
    }

    return results;
  }

  removeWorker(instanceId: string): void {
    this.states.delete(instanceId);
  }

  hasPath(instanceId: string): boolean {
    const state = this.states.get(instanceId);
    return !!state && state.pathIndex < state.path.length - 1;
  }

  private calcDirection(dx: number, dy: number): number {
    if (dx === 0 && dy < 0) return 0;  // N
    if (dx > 0 && dy < 0) return 1;    // NE
    if (dx > 0 && dy === 0) return 2;   // E
    if (dx > 0 && dy > 0) return 3;    // SE
    if (dx === 0 && dy > 0) return 4;   // S
    if (dx < 0 && dy > 0) return 5;    // SW
    if (dx < 0 && dy === 0) return 6;   // W
    if (dx < 0 && dy < 0) return 7;    // NW
    return 0;
  }
}
