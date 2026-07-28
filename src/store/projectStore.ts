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

          const { readDir, exists } = await import('@tauri-apps/plugin-fs');
          const dirExists = await exists(claudeProjectsDir);
          if (!dirExists) {
            set({ projects: [], loading: false });
            return;
          }

          const entries = await readDir(claudeProjectsDir);
          const projects: ProjectInfo[] = [];

          for (const entry of entries) {
            if (entry.isDirectory && entry.name) {
              // Decode folder name: hyphens represent path separators
              const decodedPath = entry.name
                .replace(/-/g, '/')
                .replace(/^([A-Z])\//, '$1:/'); // Restore drive letter on Windows

              const claudeMdPath = `${claudeProjectsDir}/${entry.name}/CLAUDE.md`;
              let hasClaudeMd = false;
              try {
                hasClaudeMd = await exists(claudeMdPath);
              } catch {
                // ignore
              }

              projects.push({
                name: entry.name,
                path: decodedPath,
                hasClaudeMd,
              });
            }
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
