import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_BACKGROUND, normalizeBackground, type PanelBackground } from '../lib/panelBackground';

interface AppearanceState {
  global: PanelBackground;
  panels: Record<string, PanelBackground>;
  setGlobal: (value: PanelBackground) => void;
  setPanel: (id: string, value: PanelBackground | null) => void;
  restorePanels: (panels: Record<string, PanelBackground>, mapping: Map<string,string>) => void;
}
export const useAppearanceStore = create<AppearanceState>()(persist((set) => ({
  global: { ...DEFAULT_BACKGROUND }, panels: {},
  setGlobal: value => set({ global: normalizeBackground(value) }),
  setPanel: (id, value) => set(state => {
    const panels = { ...state.panels }; if (value) panels[id] = normalizeBackground(value); else delete panels[id];
    return { panels };
  }),
  restorePanels: (values, mapping) => set(state => ({ panels: { ...state.panels, ...Object.fromEntries(Object.entries(values).map(([id,v]) => [mapping.get(id) ?? id, normalizeBackground(v)])) } })),
}), {
  name: 'tessera-appearance',
  merge: (saved, current) => {
    const value = saved as Partial<AppearanceState> | undefined;
    return { ...current, global: normalizeBackground(value?.global), panels: value?.panels && typeof value.panels === 'object'
      ? Object.fromEntries(Object.entries(value.panels).slice(0, 2000).map(([id,bg]) => [id, normalizeBackground(bg)])) : {} };
  },
}));
export function getPanelBackground(id: string): PanelBackground {
  const state = useAppearanceStore.getState(); return state.panels[id] ?? state.global;
}
