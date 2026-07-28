import { X, FolderOpen, Bot, Server, BarChart3, GitBranch } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { ProjectBrowser } from '../projects/ProjectBrowser';
import AgentList from '../agents/AgentList';
import { McpManager } from '../mcp/McpManager';
import UsageDashboard from '../analytics/UsageDashboard';
import CheckpointTimeline from '../checkpoints/CheckpointTimeline';

const WIDGET_INFO: Record<string, { icon: React.ReactNode; label: string }> = {
  projects: { icon: <FolderOpen size={14} />, label: 'Projects' },
  agents: { icon: <Bot size={14} />, label: 'Agents' },
  mcp: { icon: <Server size={14} />, label: 'MCP Servers' },
  analytics: { icon: <BarChart3 size={14} />, label: 'Analytics' },
  timeline: { icon: <GitBranch size={14} />, label: 'Timeline' },
};

interface WidgetPanelProps {
  instanceId: string;
}

export function WidgetPanel({ instanceId }: WidgetPanelProps) {
  const kind = useLayoutStore(s => s.widgetKinds[instanceId]);
  const removePanel = useLayoutStore(s => s.removePanel);
  const focusedId = useLayoutStore(s => s.focusedId);

  const info = WIDGET_INFO[kind] ?? { icon: null, label: 'Widget' };

  const renderContent = () => {
    switch (kind) {
      case 'projects':
        return <ProjectBrowser />;
      case 'agents':
        return <AgentList onSelectAgent={() => {}} onRunAgent={() => {}} />;
      case 'mcp':
        return <McpManager />;
      case 'analytics':
        return <UsageDashboard />;
      case 'timeline': {
        // Show timeline for the focused non-widget panel, or first available
        const layoutState = useLayoutStore.getState();
        let targetId = focusedId;
        if (!targetId || targetId === instanceId || layoutState.panelTypes[targetId] === 'widget') {
          targetId = layoutState.tabOrder.find(id =>
            id !== instanceId && layoutState.panelTypes[id] !== 'widget'
          ) ?? null;
        }
        return targetId
          ? <CheckpointTimeline instanceId={targetId} />
          : <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
              No instance selected for timeline
            </div>;
      }
      default:
        return <div style={{ padding: 16, color: 'var(--text-muted)' }}>Unknown widget</div>;
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-primary)',
    }}>
      {/* Toolbar - uses terminal-toolbar class so MosaicLayout drag works */}
      <div
        className="terminal-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          cursor: 'grab',
          minHeight: 32,
        }}
      >
        <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
          {info.icon}
        </span>
        <span style={{
          flex: 1,
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {info.label}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removePanel(instanceId);
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
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--error)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="Close widget"
        >
          <X size={14} />
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
      }}>
        {renderContent()}
      </div>
    </div>
  );
}
