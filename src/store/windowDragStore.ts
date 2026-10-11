import { create } from 'zustand';

export interface WindowDrag {
  panelId: string;
  source: string;
  kind: 'tab' | 'panel';
  x: number;
  y: number;
  tearOff: boolean;
  targetLabel: string | null;
  hint: string | null;
}
export const useWindowDragStore = create<{ drag: WindowDrag | null }>(() => ({ drag: null }));

export function outsideTabStrip(x: number, y: number, rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>): boolean {
  // A deliberate pull, distinct from the small vertical movement of a reorder.
  const margin = 32;
  return x < rect.left - margin || x > rect.right + margin || y < rect.top - margin || y > rect.bottom + margin;
}
