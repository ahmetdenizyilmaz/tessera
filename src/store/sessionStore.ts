import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SavedSession {
  id: string;
  instanceId: string;
  name: string;
  projectPath: string;
  messageCount: number;
  startedAt: number;
  endedAt: number;
  isFavorite: boolean;
}

interface SessionState {
  sessions: SavedSession[];
  searchQuery: string;
  addSession: (session: Omit<SavedSession, 'id' | 'isFavorite'>) => void;
  deleteSession: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setSearchQuery: (query: string) => void;
  getFilteredSessions: () => SavedSession[];
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      searchQuery: '',

      addSession: (session) => {
        const newSession: SavedSession = {
          ...session,
          id: crypto.randomUUID(),
          isFavorite: false,
        };
        set((state) => ({
          sessions: [newSession, ...state.sessions],
        }));
      },

      deleteSession: (id) => {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
        }));
      },

      toggleFavorite: (id) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, isFavorite: !s.isFavorite } : s,
          ),
        }));
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      getFilteredSessions: () => {
        const { sessions, searchQuery } = get();
        if (!searchQuery.trim()) return sessions;
        const q = searchQuery.toLowerCase();
        return sessions.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.projectPath.toLowerCase().includes(q),
        );
      },
    }),
    {
      name: 'claude-gui-sessions',
    },
  ),
);
