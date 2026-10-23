import { create } from 'zustand';
import { useInstanceStore } from './instanceStore';

export interface PanelPreview { text: string; terminal: boolean; fontSize?: number; fontFamily?: string }
interface HibernationUi {
  phases: Record<string, 'hibernating' | 'waking'>;
  errors: Record<string, string>;
  previews: Record<string, PanelPreview>;
}
export const usePanelHibernationStore = create<HibernationUi>(() => ({ phases: {}, errors: {}, previews: {} }));
export function isPanelSuspended(id: string): boolean {
  return !!useInstanceStore.getState().instances.get(id)?.hibernation?.sleeping
    || usePanelHibernationStore.getState().phases[id] === 'hibernating';
}
