import { create } from 'zustand';
import type { AntigravitySnapshot } from '../types/antigravity';
interface State {
  sessions: Record<string, AntigravitySnapshot>;
  receive: (id: string, snapshot: AntigravitySnapshot) => void;
  /** A failed configure/restart. The transcript on screen is kept. */
  error: (id: string, error?: string, unconfigured?: boolean) => void;
  remove: (id: string) => void;
}
const EMPTY: AntigravitySnapshot = { generation: '', configured: false, conversationId: null, processAlive: false, busy: false, items: [] };
export const useAntigravityStore = create<State>((set) => ({
  sessions: {},
  receive: (id, snapshot) => set(s => s.sessions[id]?.revision && s.sessions[id].revision === snapshot.revision ? s : { sessions: { ...s.sessions, [id]: snapshot } }),
  error: (id, error, unconfigured = false) => set(s => ({ sessions: { ...s.sessions, [id]: {
    ...(s.sessions[id] ?? EMPTY), error, revision: undefined,
    ...(unconfigured ? { configured: false, busy: false, processAlive: false } : {}),
  } } })),
  remove: id => set(s => { const sessions = { ...s.sessions }; delete sessions[id]; return { sessions }; }),
}));
