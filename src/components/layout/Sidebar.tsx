import { useState, useCallback, useRef } from 'react';
import { FolderOpen, Bot, Server, BarChart3, GitBranch, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { ProjectBrowser } from '../projects/ProjectBrowser';
import { ClaudeMdEditor } from '../projects/ClaudeMdEditor';
import AgentList from '../agents/AgentList';
import { McpManager } from '../mcp/McpManager';
import UsageDashboard from '../analytics/UsageDashboard';
import CheckpointTimeline from '../checkpoints/CheckpointTimeline';
import { useLayoutStore, sidebarDragState, detectSnapZone } from '../../store/layoutStore';
import type { ProjectInfo } from '../../store/projectStore';

type SidebarTab = 'projects' | 'agents' | 'mcp' | 'analytics' | 'timeline';

const SIDEBAR_TABS: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
  { id: 'projects', icon: <FolderOpen size={18} />, label: 'Projects' },
  { id: 'agents', icon: <Bot size={18} />, label: 'Agents' },
  { id: 'mcp', icon: <Server size={18} />, label: 'MCP' },
  { id: 'analytics', icon: <BarChart3 size={18} />, label: 'Analytics' },
  { id: 'timeline', icon: <GitBranch size={18} />, label: 'Timeline' },
];

export function Sidebar() {
  const focusedId = useLayoutStore(s => s.focusedId);
  const widgetKinds = useLayoutStore(s => s.widgetKinds);
  const dragReturnToSidebar = useLayoutStore(s => s.dragReturnToSidebar);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>('projects');
  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(null);

  // Track which widget kinds are already open as panels
  const openKinds = new Set(Object.values(widgetKinds));

  const handleTabClick = useCallback((tab: SidebarTab) => {
    // Skip click if a sidebar drag just completed
    if (sidebarDragState.dragCompleted) {
      sidebarDragState.dragCompleted = false;
      return;
    }
    // If this kind is already open as a panel, focus it instead
    const kinds = useLayoutStore.getState().widgetKinds;
    const existingId = Object.entries(kinds).find(([, k]) => k === tab)?.[0];
    if (existingId) {
      useLayoutStore.getState().setActiveTab(existingId);
      useLayoutStore.getState().setFocused(existingId);
      return;
    }
    if (activeTab === tab && isOpen) {
      setIsOpen(false);
    } else {
      setActiveTab(tab);
      setIsOpen(true);
    }
  }, [activeTab, isOpen]);

  const dragCleanup = useRef<(() => void) | null>(null);

  const handleIconPointerDown = useCallback((e: React.PointerEvent, tabId: SidebarTab) => {
    // Only left button
    if (e.button !== 0) return;
    // Don't start drag if this kind is already open as a panel
    const kinds = useLayoutStore.getState().widgetKinds;
    if (Object.values(kinds).includes(tabId)) return;
    // Don't start drag if max panels reached
    if (useLayoutStore.getState().tabOrder.length >= 5) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const DRAG_THRESHOLD = 6;
    let started = false;

    sidebarDragState.kind = tabId;
    sidebarDragState.startX = startX;
    sidebarDragState.startY = startY;
    sidebarDragState.started = false;
    sidebarDragState.currentSnap = null;
    sidebarDragState.dragCompleted = false;

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
            Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        sidebarDragState.started = true;
        useLayoutStore.getState().setSidebarDrag(true, null);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }

      const container = document.querySelector('.mosaic-container') as HTMLElement | null;
      const currentCount = useLayoutStore.getState().tabOrder.length;
      if (currentCount === 0) {
        sidebarDragState.currentSnap = 'center';
        useLayoutStore.getState().setSidebarDrag(true, null);
      } else if (container) {
        const b = container.getBoundingClientRect();
        const zone = detectSnapZone(
          ev.clientX - b.left, ev.clientY - b.top,
          b.width, b.height,
          currentCount + 1,
        );
        sidebarDragState.currentSnap = zone;
        useLayoutStore.getState().setSidebarDrag(true, zone);
      }
    };

    const onUp = () => {
      if (started) {
        const currentCount = useLayoutStore.getState().tabOrder.length;
        if (currentCount < 5) {
          const zone = currentCount === 0
            ? undefined
            : (sidebarDragState.currentSnap ?? undefined);
          if (currentCount === 0 || zone) {
            useLayoutStore.getState().addWidgetPanel(
              tabId,
              zone as any,
            );
          }
        }
        sidebarDragState.dragCompleted = true;
      }
      sidebarDragState.kind = null;
      sidebarDragState.started = false;
      sidebarDragState.currentSnap = null;
      useLayoutStore.getState().setSidebarDrag(false, null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragCleanup.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dragCleanup.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const renderContent = () => {
    if (editingProject) {
      return <ClaudeMdEditor project={editingProject} onClose={() => setEditingProject(null)} />;
    }

    switch (activeTab) {
      case 'projects':
        return <ProjectBrowser onEditClaudeMd={(p) => setEditingProject(p)} />;
      case 'agents':
        return <AgentList onSelectAgent={() => {}} onRunAgent={() => {}} />;
      case 'mcp':
        return <McpManager />;
      case 'analytics':
        return <UsageDashboard />;
      case 'timeline':
        return focusedId
          ? <CheckpointTimeline instanceId={focusedId} />
          : <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>Select an instance to view timeline</div>;
    }
  };

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      flexShrink: 0,
    }}>
      {/* Icon strip */}
      <div style={{
        width: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 0',
        gap: 4,
        background: dragReturnToSidebar ? 'var(--accent)' : 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        transition: 'background 0.15s',
        opacity: dragReturnToSidebar ? 0.3 : 1,
      }}>
        {SIDEBAR_TABS.map((tab) => {
          const isInPanel = openKinds.has(tab.id);
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              onPointerDown={(e) => handleIconPointerDown(e, tab.id)}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
              title={isInPanel ? `${tab.label} (open in workspace)` : `${tab.label} (drag to workspace)`}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                borderRadius: 6,
                background: activeTab === tab.id && isOpen ? 'var(--bg-elevated)' : 'transparent',
                color: isInPanel ? 'var(--accent)' : (activeTab === tab.id && isOpen ? 'var(--accent)' : 'var(--text-muted)'),
                cursor: isInPanel ? 'pointer' : 'grab',
                transition: 'all 0.15s',
                opacity: isInPanel ? 0.5 : 1,
              }}
            >
              <span style={{ pointerEvents: 'none' }}>{tab.icon}</span>
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', borderRadius: 6, background: 'transparent',
            color: 'var(--text-muted)', cursor: 'pointer',
          }}
          title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>

      {/* Content panel */}
      {isOpen && (
        <div style={{
          width: 280,
          background: 'var(--bg-primary)',
          borderRight: '1px solid var(--border)',
          overflowX: 'hidden',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Content header with pop-out button */}
          {!editingProject && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
              background: 'var(--bg-surface)',
            }}>
              <span style={{
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
              }}>
                {SIDEBAR_TABS.find(t => t.id === activeTab)?.icon}
              </span>
              <span style={{
                flex: 1,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                {SIDEBAR_TABS.find(t => t.id === activeTab)?.label}
              </span>
              {!openKinds.has(activeTab) && (
                <button
                  onClick={() => {
                    if (useLayoutStore.getState().tabOrder.length >= 5) return;
                    useLayoutStore.getState().addWidgetPanel(activeTab);
                    setIsOpen(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                  title="Open as panel in workspace"
                >
                  <ExternalLink size={14} />
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                title="Collapse"
              >
                <ChevronLeft size={14} />
              </button>
            </div>
          )}
          {openKinds.has(activeTab) ? (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 24,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}>
              <ExternalLink size={20} style={{ opacity: 0.5 }} />
              <span style={{ fontSize: 12 }}>
                Open in workspace panel
              </span>
              <button
                onClick={() => {
                  const kinds = useLayoutStore.getState().widgetKinds;
                  const existingId = Object.entries(kinds).find(([, k]) => k === activeTab)?.[0];
                  if (existingId) {
                    useLayoutStore.getState().setActiveTab(existingId);
                    useLayoutStore.getState().setFocused(existingId);
                  }
                  setIsOpen(false);
                }}
                style={{
                  marginTop: 4,
                  padding: '4px 12px',
                  fontSize: 11,
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg-elevated)',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                }}
              >
                Focus panel
              </button>
            </div>
          ) : (
            renderContent()
          )}
        </div>
      )}
    </div>
  );
}
