import { describe, expect, it } from 'vitest';
import { orderOfficeDepth, type OfficeDepth } from './officeDepth';
import { furnitureFootprint, rotatePoint } from '../lib/officeSpace';
import type { OfficeFurniture } from '../types/office';

const point = (id: string, x: number, y: number): OfficeDepth => ({ id, x, y, w: 0, h: 0 });
const order = (items: OfficeDepth[]) => orderOfficeDepth(items).map(n => n.id);

describe('office occlusion', () => {
  for (const rotation of [0, 1, 2, 3] as const) {
    it(`keeps workers in front of both near edges and behind both far edges, rotation ${rotation}`, () => {
      const f: OfficeFurniture = { id: 'sofa', type: 'couch', itemId: 'shop-couch', position: { gridX: 2, gridY: 2 }, rotation };
      const sofa = { id: f.id, x: 2, y: 2, ...furnitureFootprint(f) };
      for (const offset of [.1, .5, .9]) {
        for (const worker of [point('front', 2 + sofa.w * offset, 2 + sofa.h + .5), point('front', 2 + sofa.w + .5, 2 + sofa.h * offset)]) {
          expect(order([worker, sofa])).toEqual(['sofa', 'front']);
        }
        for (const worker of [point('back', 2 + sofa.w * offset, 1.5), point('back', 1.5, 2 + sofa.h * offset)]) {
          expect(order([sofa, worker])).toEqual(['back', 'sofa']);
        }
      }
      const seat = rotatePoint(f, .5, .55);
      expect(order([ { ...point('seated', seat.gridX, seat.gridY), seatOf: f.id }, sofa ]))
        .toEqual(['sofa', 'seated']);
    });
  }
  it('orders a worker between two neighbouring desks regardless of insertion order', () => {
    const items = [ { id: 'back', x: 0, y: 0, w: 2, h: 1 }, point('worker', .5, 1.5),
      { id: 'front', x: 0, y: 2, w: 2, h: 1 } ];
    expect(order(items)).toEqual(['back', 'worker', 'front']);
    expect(order(items.reverse())).toEqual(['back', 'worker', 'front']);
  });
  it('keeps rugs below actors and supports overlapping feet and seats', () => {
    const items = [point('a', .5, .5), point('b', .5, .5), { id: 'rug', x: 0, y: 0, w: 2, h: 2, floor: true }];
    expect(order(items)).toEqual(['rug', 'a', 'b']);
    expect(order(items.reverse())).toEqual(['rug', 'a', 'b']);
  });
  it('always returns every sprite once, even for cyclic imported layouts', () => {
    const items = [{ ...point('a', 1, 1), seatOf: 'b' }, { ...point('b', 1, 1), seatOf: 'c' }, { ...point('c', 1, 1), seatOf: 'a' }];
    expect(order(items)).toEqual(['a', 'c', 'b']);
    expect(order(items.reverse())).toEqual(['a', 'c', 'b']);
  });
});
