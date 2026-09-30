import type { GridPosition, OfficeLayout } from '../types/office';
import { blockedCells, insideOffice } from '../lib/officeSpace';

interface Node {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: Node | null;
}

function heuristic(a: GridPosition, b: GridPosition): number {
  const dx = Math.abs(a.gridX - b.gridX), dy = Math.abs(a.gridY - b.gridY);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

// Build blocked cell set from furniture

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
  if (!insideOffice(layout, start) || !insideOffice(layout, end)) return [];
  const blocked = blockedCells(layout);
  if (extraBlocked) {
    for (const cell of extraBlocked) blocked.add(cell);
  }

  // Let an agent leave a tile whose furniture was moved during its walk.
  blocked.delete(`${start.gridX},${start.gridY}`);
  if (blocked.has(`${end.gridX},${end.gridY}`)) return [];

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
      if (dx && dy && (blocked.has(`${current.x + dx},${current.y}`) || blocked.has(`${current.x},${current.y + dy}`))) continue;

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

  // Stay put when unreachable; never walk through furniture as a fallback.
  return [];
}
