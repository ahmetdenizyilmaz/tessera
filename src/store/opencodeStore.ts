import { create } from 'zustand';
import type { OpenCodeSnapshot } from '../types/opencode';
interface State {
  sessions: Record<string, OpenCodeSnapshot>;
  receive: (id: string, snapshot: OpenCodeSnapshot) => void;
  error: (id: string, error?: string, disconnected?: boolean) => void;
  remove: (id: string) => void;
}
export const useOpenCodeStore = create<State>((set) => ({
  sessions: {},
  receive: (id, snapshot) => set(s => JSON.stringify(s.sessions[id]) === JSON.stringify(snapshot) ? s : { sessions: { ...s.sessions, [id]: snapshot } }),
  error: (id, error, disconnected = false) => set(s => ({ sessions: { ...s.sessions, [id]: {
    ...(s.sessions[id] ?? { generation: '', sessionId: '', connected: false, status: { type: 'idle' }, messages: [], permissions: [], questions: [] }),
    error, ...(disconnected ? { connected: false } : {}),
  } } })),
  remove: id => set(s => { const sessions = { ...s.sessions }; delete sessions[id]; return { sessions }; }),
}));
