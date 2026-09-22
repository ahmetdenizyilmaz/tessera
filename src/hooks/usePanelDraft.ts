import { useCallback, useRef, type SetStateAction } from 'react';
import { create } from 'zustand';
import { useInstanceStore } from '../store/instanceStore';

// Group navigation unmounts composers. Keep drafts in memory until the panel
// really closes; do not save potentially sensitive unsent content to disk.
const useDrafts = create<{ panels: Record<string, Record<string, unknown>> }>(() => ({ panels: {} }));
useInstanceStore.subscribe((state, previous) => {
  if (state.instances === previous.instances) return;
  const panels = useDrafts.getState().panels;
  if (Object.keys(panels).some(id => !state.instances.has(id))) {
    useDrafts.setState({ panels: Object.fromEntries(Object.entries(panels).filter(([id]) => state.instances.has(id))) });
  }
});

export function usePanelDraft<T>(instanceId: string, field: string, initial: T) {
  const fallback = useRef(initial);
  const value = useDrafts(s => (s.panels[instanceId]?.[field] ?? fallback.current) as T);
  const setValue = useCallback((update: SetStateAction<T>) => {
    if (!useInstanceStore.getState().instances.has(instanceId)) return;
    useDrafts.setState(state => {
      const panel = state.panels[instanceId] ?? {};
      const old = (panel[field] ?? fallback.current) as T;
      const next = typeof update === 'function' ? (update as (value: T) => T)(old) : update;
      return { panels: { ...state.panels, [instanceId]: { ...panel, [field]: next } } };
    });
  }, [instanceId, field]);
  return [value, setValue] as const;
}
