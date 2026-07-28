import type { GridPosition, OfficeLayout } from '../types/office';
import { FURNITURE_SIZES } from './SpriteManager';

interface Node {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

function heuristic(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.gridX - b.gridX) + Math.abs(a.gridY - b.gridY);
}

// Build blocked cell set from furniture
function getBlockedCells(layout: OfficeLayout): Set<string> {
  const blocked = new Set<string>();
  for (const f of layout.furniture) {
    const size = FURNITURE_SIZES[f.type] ?? { w: 1, h: 1 };
    for (let dx = 0; dx < size.w; dx++) {
      for (let dy = 0; dy < size.h; dy++) {
        blocked.add(`${f.position.gridX + dx},${f.position.gridY + dy}`);
      }
    }
  }
  return blocked;
}

// 8-directional neighbors
const DIRS = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
  [1, -1], [1, 1], [-1, 1], [-1, -1],
];

export function findPath(
  layout: OfficeLayout,
  start: GridPosition,
  end: GridPosition,
  extraBlocked?: Set<string>,
): GridPosition[] {
  const blocked = getBlockedCells(layout);
  if (extraBlocked) {
    for (const cell of extraBlocked) blocked.add(cell);
  }

  // Don't block start or end
  blocked.delete(`${start.gridX},${start.gridY}`);
  blocked.delete(`${end.gridX},${end.gridY}`);

  const open: Node[] = [];
  const closed = new Set<string>();

  const startNode: Node = {
    x: start.gridX, y: start.gridY,
    g: 0,
    h: heuristic(start, end),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  open.push(startNode);

  while (open.length > 0) {
    // Find lowest f
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;

    if (current.x === end.gridX && current.y === end.gridY) {
      // Reconstruct path
      const path: GridPosition[] = [];
      let node: Node | null = current;
      while (node) {
        path.unshift({ gridX: node.x, gridY: node.y });
        node = node.parent;
      }
      return path;
    }

    closed.add(`${current.x},${current.y}`);

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const key = `${nx},${ny}`;

      if (nx < 0 || ny < 0 || nx >= layout.width || ny >= layout.height) continue;
      if (closed.has(key)) continue;
      if (blocked.has(key)) continue;

      // Diagonal cost is sqrt(2), cardinal is 1
      const moveCost = (dx !== 0 && dy !== 0) ? 1.414 : 1;
      const g = current.g + moveCost;

      const existing = open.find(n => n.x === nx && n.y === ny);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = g + existing.h;
          existing.parent = current;
        }
      } else {
        const h = heuristic({ gridX: nx, gridY: ny }, end);
        open.push({ x: nx, y: ny, g, h, f: g + h, parent: current });
      }
    }
  }

  // No path found - return direct line (fallback)
  return [start, end];
}
