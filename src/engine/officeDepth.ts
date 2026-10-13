/** Ground footprints, in tile coordinates. Height must not affect depth:
 * a tall object behind a worker must still be drawn behind that worker. */
export interface OfficeDepth {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor?: boolean;
  seatOf?: string;
}

/** Painter's order from footprint separation on either isometric axis.
 * Sorting only by the nearest corner hides workers along a wide item's front
 * edge; sorting by its centre incorrectly exposes workers along its back edge.
 * A partial order handles both, with stable depth ordering for unrelated items.
 */
export function orderOfficeDepth<T extends OfficeDepth>(items: readonly T[]): T[] {
  const nodes = [...items].sort((a, b) =>
    Number(!!b.floor) - Number(!!a.floor) ||
    (a.x + a.y + (a.w + a.h) / 2) - (b.x + b.y + (b.w + b.h) / 2) ||
    a.id.localeCompare(b.id));
  const edges: number[][] = nodes.map(() => []), incoming = nodes.map(() => 0);
  const before = (a: T, b: T) => a.x + a.w <= b.x || a.y + a.h <= b.y;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    let direction = 0;
    if (!!a.floor !== !!b.floor) direction = a.floor ? -1 : 1;
    else if (a.seatOf === b.id) direction = 1;
    else if (b.seatOf === a.id) direction = -1;
    else {
      const ab = before(a, b), ba = before(b, a);
      // Opposite directions mean the footprints are diagonally separated,
      // with no overlapping projected floor area. Neither imposes an order.
      if (ab !== ba) direction = ab ? -1 : 1;
    }
    if (direction) {
      const [from, to] = direction < 0 ? [i, j] : [j, i];
      edges[from].push(to); incoming[to]++;
    }
  }
  const remaining = new Set(nodes.map((_, i) => i)), result: T[] = [];
  while (remaining.size) {
    // The centre-depth order breaks ties consistently. In a cyclic layout,
    // break the cycle deterministically instead of stalling the render loop.
    const next = [...remaining].find(i => incoming[i] === 0) ?? remaining.values().next().value!;
    remaining.delete(next); result.push(nodes[next]);
    for (const to of edges[next]) incoming[to]--;
  }
  return result;
}
