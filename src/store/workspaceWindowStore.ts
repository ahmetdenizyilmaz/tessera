import { create } from 'zustand';

export interface DetachedWorkspace {
  id: string;
  groupId: string;
  bounds?: { x: number; y: number; width: number; height: number };
}
interface WorkspaceWindows {
  windows: DetachedWorkspace[];
  add: (window: DetachedWorkspace) => void;
  remove: (id: string) => void;
  setBounds: (id: string, bounds: NonNullable<DetachedWorkspace['bounds']>) => void;
}
export const useWorkspaceWindowStore = create<WorkspaceWindows>((set) => ({
  windows: [],
  add: window => set(state => ({ windows: [...state.windows.filter(w => w.id !== window.id), window] })),
  remove: id => set(state => ({ windows: state.windows.filter(w => w.id !== id) })),
  setBounds: (id, bounds) => set(state => state.windows.some(w => w.id === id) ? { windows: state.windows.map(w => w.id === id ? { ...w, bounds } : w) } : state),
}));
