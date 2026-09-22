import { Folder, Monitor, LayoutGrid, Puzzle, LogIn, MessageSquare, Brain, X, WifiOff, Terminal } from 'lucide-react';
import { useGroupStore } from '../../store/groupStore';
import { useLayoutStore, type PanelType } from '../../store/layoutStore';
import { useInstanceStore } from '../../store/instanceStore';
import { usePluginStore } from '../../store/pluginStore';
import { ProviderIcon, ClaudeIcon } from '../icons/ProviderIcons';
import { closePanel } from '../../lib/panelCleanup';
import { splitRemotePanelId, useLanStore } from '../../store/lanStore';
import { PanelShortcutBadge } from '../layout/PanelShortcutBadge';

interface GroupPreviewProps {
  groupId: string;
}

const EMPTY_CHILD_IDS: string[] = [];

// Large icon size for child tiles
const ICON_SIZE = 32;
// Small badge icon size
const BADGE_SIZE = 12;

function ChildTile({ childId }: { childId: string }) {
  const rawPanelType = useLayoutStore((s) => s.panelTypes[childId]);
  const panelType: PanelType = rawPanelType ?? 'terminal';
  const instance = useInstanceStore((s) => s.instances.get(childId));
  const group = useGroupStore((s) => s.groups.get(childId));
  const widgetKind = useLayoutStore((s) => s.widgetKinds[childId]);
  const pluginInstance = usePluginStore((s) => s.instances.get(childId));
  const remoteAddress = splitRemotePanelId(childId);
  const lanStatus = useLanStore((s) => s.status);
  const remotePeer = lanStatus?.peers.find((p) => p.deviceId === remoteAddress?.deviceId);
  const remotePanel = remotePeer?.panels.find((p) => p.id === remoteAddress?.panelId);
  const remote = remotePeer && remotePanel ? { peer: remotePeer, panel: remotePanel } : null;

  const isGroup = panelType === 'group';
  const isWidget = panelType === 'widget';

  let icon: React.ReactNode;
  let badge: React.ReactNode = null;
  let name: string;
  let color: string;

  if (panelType === 'remote' && remote) {
    color = remote.peer.connected ? '#51cf66' : '#868e96';
    icon = <ProviderIcon provider={remote.panel.provider} size={ICON_SIZE} />;
    badge = !remote.peer.connected ? <WifiOff size={BADGE_SIZE} />
      : remote.panel.kind === 'terminal' ? <Terminal size={BADGE_SIZE} /> : <MessageSquare size={BADGE_SIZE} />;
    name = remote.panel.name;
  } else if (isGroup && group) {
    color = group.color ?? '#4a9eff';
    icon = <Folder size={ICON_SIZE} />;
    name = group.name;
  } else if (isWidget) {
    color = '#4a9eff';
    icon = <LayoutGrid size={ICON_SIZE} />;
    name = widgetKind ?? 'Widget';
  } else if (panelType === 'computer') {
    color = instance?.color ?? '#51cf66';
    icon = <Monitor size={ICON_SIZE} />;
    name = instance?.name ?? 'Computer';
  } else if (panelType === 'llm') {
    const provider = instance?.config.llmConfig?.provider ?? 'openai';
    color = instance?.color ?? '#ffd43b';
    icon = <ProviderIcon provider={provider} size={ICON_SIZE} />;
    badge = <Brain size={BADGE_SIZE} />;
    name = instance?.name ?? 'LLM';
  } else if (panelType === 'plugin') {
    color = '#cc5de8';
    icon = <Puzzle size={ICON_SIZE} />;
    name = pluginInstance?.title ?? 'Plugin';
  } else {
    // terminal (Claude chat)
    color = instance?.color ?? '#4a9eff';
    icon = <ClaudeIcon size={ICON_SIZE} />;
    badge = <MessageSquare size={BADGE_SIZE} />;
    name = instance?.name ?? 'Chat';
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        minWidth: 80,
        maxWidth: 110,
      }}
    >
      {/* Large icon circle with instance color */}
      <div
        style={{
          position: 'relative',
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: `${color}18`,
          border: `2px solid ${color}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: color,
          flexShrink: 0,
          boxShadow: `0 0 16px ${color}20`,
        }}
      >
        {icon}
        {/* Small type badge in bottom-right corner */}
        {badge && (
          <div
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'var(--bg-surface)',
              border: `1.5px solid ${color}60`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: color,
              fontSize: 10,
            }}
          >
            {badge}
          </div>
        )}
      </div>
      {/* Name label */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          textAlign: 'center',
        }}
      >
        {name}
      </span>
    </div>
  );
}

export function GroupPreview({ groupId }: GroupPreviewProps) {
  const group = useGroupStore((s) => s.groups.get(groupId));
  const remotePeer = useLanStore((s) => s.status?.peers.find((p) => p.deviceId === group?.remotePeerId));
  const childIds = group?.childIds ?? EMPTY_CHILD_IDS;
  const enterGroup = useGroupStore((s) => s.enterGroup);
  const isBeingEntered = useGroupStore(
    (s) => s.transitionDirection === 'enter' && s.transitionGroupId === groupId,
  );

  const handleEnter = () => {
    enterGroup(groupId);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary)',
        opacity: isBeingEntered ? 0 : 1,
        transition: 'opacity 0.22s ease',
      }}
    >
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
        onDoubleClick={handleEnter}
      >
        <span style={{ color: group?.color ?? 'var(--accent)', display: 'flex', alignItems: 'center' }}>
          {group?.remotePeerId ? <Monitor size={14} /> : <Folder size={14} />}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {group?.name ?? 'Group'}
          <PanelShortcutBadge panelId={groupId} />
          {childIds.length > 0 && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
              {childIds.length}
            </span>
          )}
          {group?.remotePeerId && (
            <span style={{ fontWeight: 400, color: remotePeer?.connected ? '#51cf66' : 'var(--text-muted)', marginLeft: 6 }}>
              {remotePeer?.connected ? 'online' : 'offline'}
            </span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); handleEnter(); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            background: 'rgba(74, 158, 255, 0.15)',
            border: '1px solid rgba(74, 158, 255, 0.3)',
            borderRadius: 4,
            color: 'var(--accent)',
            fontSize: 11,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title="Enter group"
        >
          <LogIn size={12} />
          Enter
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); void closePanel(groupId); }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            padding: 0,
            background: 'none',
            border: 'none',
            borderRadius: 4,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          aria-label={group?.remotePeerId ? 'Close remote group locally' : 'Close group and all panels'}
          title={group?.remotePeerId ? 'Close group locally (all host panels keep running)' : 'Close group and all panels inside'}
        >
          <X size={14} />
        </button>
      </div>

      {/* Preview content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          gap: 8,
          overflow: 'auto',
          cursor: 'pointer',
        }}
        onClick={handleEnter}
      >
        {childIds.length === 0 ? (
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 12,
              textAlign: 'center',
            }}
          >
            {group?.remotePeerId
              ? !remotePeer?.connected ? 'Remote computer is offline'
                : remotePeer.registryReady === false ? 'Waiting for shared panels…'
                : remotePeer.panels.length > 0 ? 'All remote panels are closed locally' : 'No open panels on this computer'
              : 'Empty group'}
            <br />
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              {group?.remotePeerId && remotePeer?.panels.length
                ? 'Restore panels in Settings → Local Network' : 'Click to enter'}
            </span>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%',
            }}
          >
            {childIds.map((childId) => (
              <ChildTile key={childId} childId={childId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
