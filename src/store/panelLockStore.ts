import { create } from 'zustand';

/** Panel identities span Main, groups and detached windows. Workspace saving
 * remaps these alongside session IDs; locking never changes the sessions. */
export const usePanelLockStore = create<{
  lockedIds: Set<string>;
  setLocked: (id: string, locked: boolean) => void;
}>((set, get) => ({
  lockedIds: new Set(),
  setLocked: (id, locked) => {
    const lockedIds = new Set(get().lockedIds);
    if (locked) lockedIds.add(id); else lockedIds.delete(id);
    set({ lockedIds });
  },
}));
