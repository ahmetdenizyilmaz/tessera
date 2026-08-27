import { useEffect, useCallback } from 'react';
import { useProjectStore, type ProjectInfo } from '../../store/projectStore';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import { FolderOpen, FileText, MessageSquare, SquareTerminal, RefreshCw, Search, Star, Pin } from 'lucide-react';

interface ProjectBrowserProps {
  onEditClaudeMd?: (project: ProjectInfo) => void;
}

export function ProjectBrowser({ onEditClaudeMd }: ProjectBrowserProps) {
  const { loading, error, fetchProjects, searchQuery, setSearchQuery, favorites, pinned, toggleFavorite, togglePin, getFilteredProjects } = useProjectStore();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const filteredProjects = getFilteredProjects();

  const handleCreateInstance = useCallback((project: ProjectInfo, panelView: 'chat' | 'terminal') => {
    const settings = useSettingsStore.getState().settings;
    const name = project.path.split(/[/\\]/).pop() || project.name;
    const id = useInstanceStore.getState().addInstance({
      cwd: project.path,
      model: settings.defaultModel,
      dangerouslySkipPermissions: settings.defaultSkipPermissions,
      permissionMode: settings.defaultPermissionMode,
      allowedTools: [],
      maxBudget: 0,
      systemPrompt: '',
      agentMode: settings.defaultAgentMode,
      panelView,
    }, name);
    useLayoutStore.getState().addPanel(id);
    useLayoutStore.getState().setActiveTab(id);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Projects
        </span>
        <button
          onClick={() => fetchProjects()}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 8px', margin: '4px 8px', borderRadius: 6,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      }}>
        <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search projects..."
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            color: 'var(--text-primary)', fontSize: 12,
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
        {loading && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            Scanning projects...
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--error)', fontSize: 12 }}>
            Failed to scan projects: {error}
          </div>
        )}

        {!loading && !error && filteredProjects.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {searchQuery ? 'No matching projects' : 'No projects found in ~/.claude/projects/'}
          </div>
        )}

        {filteredProjects.map((project) => {
          const isFav = favorites.includes(project.path);
          const isPinned = pinned.includes(project.path);

          return (
            <div
              key={project.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                transition: 'background 0.15s',
                marginBottom: 2,
              }}
              className="project-item"
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <FolderOpen size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.path.split(/[/\\]/).pop() || project.path}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.path}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); togglePin(project.path); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    color: isPinned ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                  title={isPinned ? 'Unpin' : 'Pin'}
                >
                  <Pin size={13} fill={isPinned ? 'currentColor' : 'none'} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(project.path); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    color: isFav ? '#f5a623' : 'var(--text-muted)',
                  }}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star size={13} fill={isFav ? 'currentColor' : 'none'} />
                </button>
                {project.hasClaudeMd && onEditClaudeMd && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditClaudeMd(project); }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}
                    title="Edit CLAUDE.md"
                  >
                    <FileText size={13} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleCreateInstance(project, 'chat'); }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 2 }}
                  title="Open as chat panel"
                >
                  <MessageSquare size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCreateInstance(project, 'terminal'); }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 2 }}
                  title="Open as terminal panel"
                >
                  <SquareTerminal size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
