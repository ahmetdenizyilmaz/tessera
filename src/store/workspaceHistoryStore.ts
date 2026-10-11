import { create } from 'zustand';
import { notify } from '../lib/toast';

export interface WorkspaceEdit {
  label: string;
  undo: () => boolean | Promise<boolean>;
  redo: () => boolean | Promise<boolean>;
  valid?: (direction: 'undo' | 'redo') => boolean;
}

interface WorkspaceHistory {
  past: WorkspaceEdit[];
  future: WorkspaceEdit[];
  busy: boolean;
  record: (edit: WorkspaceEdit) => void;
  clear: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const LIMIT = 50;

/** Deliberately records only explicit close and resize commands. Never snapshots
 * the workspace or observes chat edits, navigation, creation or panel moves. */
export const useWorkspaceHistoryStore = create<WorkspaceHistory>((set, get) => {
  let generation = 0;
  const run = async (direction: 'undo' | 'redo') => {
    if (get().busy) return;
    const source = direction === 'undo' ? 'past' : 'future';
    const target = direction === 'undo' ? 'future' : 'past';
    set({ busy: true });
    const started = generation;
    try {
      let edit = get()[source].at(-1);
      // A later move/add may invalidate old geometry. Skip it instead of
      // putting panels back in obsolete slots or blocking older close actions.
      while (edit && edit.valid && !edit.valid(direction)) {
        set(state => ({ [source]: state[source].slice(0, -1) }));
        edit = get()[source].at(-1);
      }
      if (!edit || !await edit[direction]()) return;
      if (generation !== started) return;
      const applied = edit;
      set(state => ({
        [source]: state[source].filter(item => item !== applied),
        [target]: [...state[target], applied].slice(-LIMIT),
      }));
    } catch (error) {
      notify(`Could not ${direction}: ${String(error)}`);
    } finally { set({ busy: false }); }
  };
  return {
    past: [], future: [], busy: false,
    record: edit => { generation++; set(state => ({ past: [...state.past, edit].slice(-LIMIT), future: [] })); },
    clear: () => { generation++; set({ past: [], future: [] }); },
    undo: () => run('undo'),
    redo: () => run('redo'),
  };
});
