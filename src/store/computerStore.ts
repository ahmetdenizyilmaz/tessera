import { create } from 'zustand';

interface ComputerSession {
  id: string;
  targetWindow: string | null;
  pollInterval: number;
  isActive: boolean;
}

interface ComputerState {
  sessions: Map<string, ComputerSession>;
  addSession: (id: string) => void;
  removeSession: (id: string) => void;
  setTargetWindow: (id: string, windowName: string | null) => void;
  setPollInterval: (id: string, interval: number) => void;
  setActive: (id: string, active: boolean) => void;
  getSession: (id: string) => ComputerSession | undefined;
}

export const useComputerStore = create<ComputerState>((set, get) => ({
  sessions: new Map(),

  addSession: (id: string) => {
    set((state) => {
      const next = new Map(state.sessions);
      next.set(id, {
        id,
        targetWindow: null,
        pollInterval: 1000,
        isActive: false,
      });
      return { sessions: next };
    });
  },

  removeSession: (id: string) => {
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(id);
      return { sessions: next };
    });
  },

  setTargetWindow: (id: string, windowName: string | null) => {
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...session, targetWindow: windowName });
      return { sessions: next };
    });
  },

  setPollInterval: (id: string, interval: number) => {
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...session, pollInterval: interval });
      return { sessions: next };
    });
  },

  setActive: (id: string, active: boolean) => {
    set((state) => {
      const session = state.sessions.get(id);
      if (!session) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...session, isActive: active });
      return { sessions: next };
    });
  },

  getSession: (id: string) => {
    return get().sessions.get(id);
  },
}));
