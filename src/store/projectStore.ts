import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ProjectInfo {
  name: string;
  path: string;
  hasClaudeMd: boolean;
}

interface ProjectState {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  loading: boolean;
  error: string | null;
  favorites: string[];
  pinned: string[];
  searchQuery: string;
  fetchProjects: () => Promise<void>;
  selectProject: (project: ProjectInfo | null) => void;
  toggleFavorite: (path: string) => void;
  togglePin: (path: string) => void;
  setSearchQuery: (query: string) => void;
  getFilteredProjects: () => ProjectInfo[];
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      selectedProject: null,
      loading: false,
      error: null,
      favorites: [],
      pinned: [],
      searchQuery: '',

      fetchProjects: async () => {
        set({ loading: true, error: null });
        try {
          // Scan ~/.claude/projects/ directory
          const homeDir = await import('@tauri-apps/api/path').then(m => m.homeDir());
          const claudeProjectsDir = `${homeDir}.claude/projects`;

          const { readDir, exists, readTextFileLines } = await import('@tauri-apps/plugin-fs');
          const dirExists = await exists(claudeProjectsDir);
          if (!dirExists) {
            set({ projects: [], loading: false });
            return;
          }

          const entries = await readDir(claudeProjectsDir);
          const projects: ProjectInfo[] = [];

          for (const entry of entries) {
            if (!entry.isDirectory || !entry.name) continue;
            const dirPath = `${claudeProjectsDir}/${entry.name}`;

            // The folder name encodes the cwd with '-' for every separator —
            // but real folder names contain hyphens too ("claude-gui-v2"), so
            // decoding the name is ambiguous. The session records inside carry
            // the true cwd on nearly every line; read it from there and only
            // fall back to the lossy decode for dirs with no usable session.
            let realCwd: string | null = null;
            try {
              const files = await readDir(dirPath);
              const sessions = files.filter((f) => !f.isDirectory && f.name?.endsWith('.jsonl'));
              for (const f of sessions.slice(0, 3)) {
                try {
                  const lines = await readTextFileLines(`${dirPath}/${f.name}`);
                  let scanned = 0;
                  for await (const line of lines) {
                    if (realCwd || ++scanned > 20) break;
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                      const obj = JSON.parse(trimmed);
                      if (typeof obj.cwd === 'string' && obj.cwd) realCwd = obj.cwd;
                    } catch { /* not JSON — keep scanning */ }
                  }
                } catch { /* unreadable file — try the next one */ }
                if (realCwd) break;
              }
            } catch { /* unreadable dir — fall through to the decode */ }

            const decodedPath = realCwd ?? entry.name
              .replace(/-/g, '/')
              .replace(/^([A-Za-z])\/\//, '$1:/')
              .replace(/^([A-Za-z])\//, '$1:/');

            // CLAUDE.md lives in the project folder itself, not in the
            // session-history folder.
            let hasClaudeMd = false;
            try {
              hasClaudeMd = await exists(`${decodedPath}/CLAUDE.md`);
            } catch {
              // outside fs scope or gone — treat as absent
            }

            projects.push({
              name: entry.name,
              path: decodedPath,
              hasClaudeMd,
            });
          }

          set({ projects, loading: false });
        } catch (e) {
          set({ error: String(e), loading: false });
        }
      },

      selectProject: (project) => {
        set({ selectedProject: project });
      },

      toggleFavorite: (path: string) => {
        const { favorites } = get();
        if (favorites.includes(path)) {
          set({ favorites: favorites.filter(f => f !== path) });
        } else {
          set({ favorites: [...favorites, path] });
        }
      },

      togglePin: (path: string) => {
        const { pinned } = get();
        if (pinned.includes(path)) {
          set({ pinned: pinned.filter(p => p !== path) });
        } else {
          set({ pinned: [...pinned, path] });
        }
      },

      setSearchQuery: (query: string) => {
        set({ searchQuery: query });
      },

      getFilteredProjects: () => {
        const { projects, searchQuery, pinned, favorites } = get();
        const query = searchQuery.toLowerCase();

        const filtered = query
          ? projects.filter(p =>
              p.path.toLowerCase().includes(query) ||
              p.name.toLowerCase().includes(query)
            )
          : projects;

        return [...filtered].sort((a, b) => {
          const aPinned = pinned.includes(a.path);
          const bPinned = pinned.includes(b.path);
          if (aPinned !== bPinned) return aPinned ? -1 : 1;

          const aFav = favorites.includes(a.path);
          const bFav = favorites.includes(b.path);
          if (aFav !== bFav) return aFav ? -1 : 1;

          return 0;
        });
      },
    }),
    {
      name: 'project-store',
      partialize: (state: ProjectState) => ({
        favorites: state.favorites,
        pinned: state.pinned,
      }),
    },
  )
);
