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
  /** Claude session id, when the panel had one — what makes a history row
   *  reopenable. Absent on rows written before this field existed. */
  claudeSessionId?: string;
  panelView?: 'chat' | 'terminal';
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
        // One row per conversation: the close handler runs on every app
        // close, and without dedupe each close appended another copy of
        // every open panel.
        const prior = session.claudeSessionId
          ? get().sessions.find((s) => s.claudeSessionId === session.claudeSessionId)
          : undefined;
        const newSession: SavedSession = {
          ...session,
          startedAt: prior?.startedAt ?? session.startedAt,
          id: crypto.randomUUID(),
          isFavorite: prior?.isFavorite ?? false,
        };
        set((state) => ({
          sessions: [
            newSession,
            ...state.sessions.filter((s) => s.id !== prior?.id),
          ],
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
