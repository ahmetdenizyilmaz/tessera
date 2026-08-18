import { useEffect, useRef, useState } from 'react';
import { Folder, ChevronRight } from 'lucide-react';
import { useGroupStore } from '../../store/groupStore';
import { useLayoutStore } from '../../store/layoutStore';
import { isClaudePanel } from '../../lib/sessionActions';

interface TabContextMenuProps {
  x: number;
  y: number;
  tabId: string;
  onRename: () => void;
  onChangeColor: () => void;
  onSwitchSession: () => void;
  onStartFresh: () => void;
  onClose: () => void;
  onDismiss: () => void;
}

// ─── Move To Submenu ─────────────────────────────────────────────────────────

interface MoveToItem {
  id: string | null; // null = root (Main)
  name: string;
  depth: number;
}

function buildMoveToList(
  tabId: string,
  currentGroupId: string | null,
): MoveToItem[] {
  const { groups } = useGroupStore.getState();
  const { tabOrder, panelTypes } = useLayoutStore.getState();

  const items: MoveToItem[] = [];

  // "Main" (root level) - always first
  items.push({ id: null, name: 'Main', depth: 0 });

  // Collect all groups that are valid move targets
  // A group is at root level if it's in the root tabOrder and panelType is 'group'
  // Or if it exists in groups map with parentId = null
  const rootGroupIds = tabOrder.filter((id) => panelTypes[id] === 'group');

  // Recursively add groups and sub-groups
  function addGroup(groupId: string, depth: number) {
    const group = groups.get(groupId);
    if (!group) return;

    // Don't list the tab itself as a move target (if it's a group)
    if (groupId === tabId) return;

    items.push({ id: groupId, name: group.name, depth });

    // Add child groups recursively
    for (const childId of group.childIds) {
      const childType = panelTypes[childId];
      if (childType === 'group' || groups.has(childId)) {
        addGroup(childId, depth + 1);
      }
    }
  }

  // Start with root-level groups
  for (const gid of rootGroupIds) {
    addGroup(gid, 1);
  }

  // Also include groups that are nested but not in root tabOrder
  // (they'll be covered by the recursive addGroup above)

  return items;
}

function MoveToSubmenu({ tabId, onDismiss }: { tabId: string; onDismiss: () => void }) {
  const currentGroupId = useGroupStore((s) => s.getCurrentGroupId());
  const items = buildMoveToList(tabId, currentGroupId);

  const handleMoveTo = (targetGroupId: string | null) => {
    // movePanelToLevel is the same primitive the breadcrumb-drop uses. The old
    // remove+addPanel path added to the LIVE tabOrder, which inside a group is
    // that group's own view — so "Move to Main" just re-added the panel to the
    // current group and the exit-sync wrote it right back.
    useGroupStore.getState().movePanelToLevel(tabId, targetGroupId);
    onDismiss();
  };

  // Don't show if no groups exist at all and we're at root (nothing to move to)
  if (items.length <= 1) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: '100%',
        top: 0,
        marginLeft: 2,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 4,
        minWidth: 160,
        maxHeight: 300,
        overflowY: 'auto',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        zIndex: 10001,
      }}
    >
      {items.map((item) => {
        // Don't show the group we're currently in as a target
        // (unless we want to allow explicit moves to the same group)
        const isCurrent = item.id === currentGroupId;

        return (
          <button
            key={item.id ?? 'root'}
            className={`context-menu-item${isCurrent ? ' context-menu-item-current' : ''}`}
            style={{
              paddingLeft: 12 + item.depth * 16,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: isCurrent ? 0.4 : 1,
              cursor: isCurrent ? 'default' : 'pointer',
            }}
            onClick={() => {
              if (!isCurrent) handleMoveTo(item.id);
            }}
            disabled={isCurrent}
          >
            {item.id !== null && (
              <Folder size={12} style={{ flexShrink: 0, color: 'var(--accent)' }} />
            )}
            <span>{item.name}</span>
            {isCurrent && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                (current)
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Context Menu ───────────────────────────────────────────────────────

export function TabContextMenu({
  x,
  y,
  tabId,
  onRename,
  onChangeColor,
  onSwitchSession,
  onStartFresh,
  onClose,
  onDismiss,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showMoveTo, setShowMoveTo] = useState(false);
  const groups = useGroupStore((s) => s.groups);
  // Session actions only make sense on panels that host a Claude session
  const claudePanel = isClaudePanel(tabId);

  // Determine if "Move to..." should be shown
  // Show when: groups exist OR panel is inside a group
  const currentGroupId = useGroupStore((s) => s.getCurrentGroupId());
  const hasGroups = groups.size > 0;
  const showMoveToOption = hasGroups || currentGroupId !== null;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onDismiss]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
      }}
    >
      <button
        className="context-menu-item"
        onClick={() => { onRename(); onDismiss(); }}
      >
        Rename
      </button>
      <button
        className="context-menu-item"
        onClick={() => { onChangeColor(); onDismiss(); }}
      >
        Change Color
      </button>

      {/* Move to... with submenu */}
      {showMoveToOption && (
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowMoveTo(true)}
          onMouseLeave={() => setShowMoveTo(false)}
        >
          <button
            className="context-menu-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>Move to...</span>
            <ChevronRight size={12} style={{ color: 'var(--text-muted)', marginLeft: 8 }} />
          </button>
          {showMoveTo && (
            <MoveToSubmenu tabId={tabId} onDismiss={onDismiss} />
          )}
        </div>
      )}

      {claudePanel && (
        <>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            title="Point this panel at a different conversation — name, color and layout stay"
            onClick={() => { onSwitchSession(); onDismiss(); }}
          >
            Switch session…
          </button>
          <button
            className="context-menu-item"
            title="Drop the current conversation and start empty in the same folder"
            onClick={() => { onStartFresh(); onDismiss(); }}
          >
            Start fresh session
          </button>
        </>
      )}

      <div className="context-menu-separator" />
      <button
        className="context-menu-item context-menu-item-danger"
        onClick={() => { onClose(); onDismiss(); }}
      >
        Close
      </button>
    </div>
  );
}
