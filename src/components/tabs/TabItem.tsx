import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { FolderOpen, Folder, Bot, Server, BarChart3, GitBranch, Puzzle, Plus } from 'lucide-react';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { usePluginStore } from '../../store/pluginStore';
import { closePanel } from '../../lib/panelCleanup';
import claudeIcon from '../../assets/claude-icon.ico';
import openaiIcon from '../../assets/openai-icon.png';
import geminiIcon from '../../assets/gemini-icon.png';
import ollamaIcon from '../../assets/ollama-icon.svg';
import lmstudioIcon from '../../assets/lmstudio-icon.png';

const PROVIDER_ICONS: Record<string, string> = {
  claude: claudeIcon,
  anthropic: claudeIcon,
  openai: openaiIcon,
  gemini: geminiIcon,
  ollama: ollamaIcon,
  lmstudio: lmstudioIcon,
};

const WIDGET_TAB_INFO: Record<string, { icon: React.ReactNode; label: string }> = {
  projects: { icon: <FolderOpen size={13} />, label: 'Projects' },
  agents: { icon: <Bot size={13} />, label: 'Agents' },
  mcp: { icon: <Server size={13} />, label: 'MCP' },
  analytics: { icon: <BarChart3 size={13} />, label: 'Analytics' },
  timeline: { icon: <GitBranch size={13} />, label: 'Timeline' },
  'new-session': { icon: <Plus size={13} />, label: 'New Session' },
};

interface TabItemProps {
  id: string;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  isDragActive?: boolean;
  dragSourceId?: string | null;
}

export function TabItem({ id, onContextMenu, isDragActive, dragSourceId }: TabItemProps) {
  const instance = useInstanceStore((s) => s.instances.get(id));
  const activeTabId = useLayoutStore((s) => s.activeTabId);
  const panelType = useLayoutStore((s) => s.panelTypes[id]);
  const widgetKind = useLayoutStore((s) => s.widgetKinds[id]);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const setFocused = useLayoutStore((s) => s.setFocused);
  const group = useGroupStore((s) => s.groups.get(id));
  const enterGroup = useGroupStore((s) => s.enterGroup);
  const pluginInstance = usePluginStore((s) => s.instances.get(id));

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: isRenaming });

  // Group tabs are also droppable targets for cross-group moves
  const isGroup = panelType === 'group';
  const isValidDropTarget = isGroup && isDragActive && dragSourceId !== id;
  const { setNodeRef: setDroppableRef, isOver: isDropOver } = useDroppable({
    id,
    disabled: !isValidDropTarget,
  });

  // Combine sortable and droppable refs
  const setNodeRef = (node: HTMLElement | null) => {
    setSortableRef(node);
    if (isGroup) setDroppableRef(node);
  };

  const isWidget = panelType === 'widget';
  const isPlugin = panelType === 'plugin';

  if (!isWidget && !isGroup && !isPlugin && !instance) return null;

  const isActive = activeTabId === id;

  const handleClick = () => {
    setActiveTab(id);
    setFocused(id);
  };

  const handleDoubleClick = () => {
    if (isGroup) {
      enterGroup(id);
      return;
    }
    // Widgets have fixed labels; instances and plugins rename inline
    if (isWidget) return;
    setRenameValue(tabName);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const v = renameValue.trim();
    setIsRenaming(false);
    if (!v || v === tabName) return;
    if (isPlugin) {
      usePluginStore.getState().setInstanceTitle(id, v);
    } else {
      useInstanceStore.getState().setName(id, v);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await closePanel(id);
  };

  const widgetInfo = isWidget ? WIDGET_TAB_INFO[widgetKind] : null;

  // Determine display name and icon
  const tabName = isGroup
    ? (group?.name ?? 'Group')
    : isWidget
    ? (widgetInfo?.label ?? 'Widget')
    : isPlugin
    ? (pluginInstance?.title ?? 'Plugin')
    : instance!.name;

  // Visual class for drop-target highlight
  const dropTargetClass = isDropOver && isValidDropTarget ? ' tab-item-drop-target' : '';

  return (
    <div
      ref={setNodeRef}
      className={`tab-item ${isActive ? 'tab-item-active' : ''}${dropTargetClass}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => onContextMenu(e, id)}
      {...attributes}
      {...listeners}
    >
      {isGroup ? (
        <span className="tab-provider-icon" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: group?.color ?? 'var(--accent)', width: 16, height: 16,
        }}>
          <Folder size={13} />
        </span>
      ) : isWidget ? (
        <span className="tab-provider-icon" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', width: 16, height: 16,
        }}>
          {widgetInfo?.icon}
        </span>
      ) : isPlugin ? (
        <span className="tab-provider-icon" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', width: 16, height: 16,
        }}>
          <Puzzle size={13} />
        </span>
      ) : (
        <img
          className="tab-provider-icon"
          src={PROVIDER_ICONS[instance!.config.llmConfig?.provider ?? 'claude'] ?? claudeIcon}
          alt=""
          style={{ filter: `drop-shadow(0 0 3px ${instance!.color})` }}
        />
      )}
      {isRenaming ? (
        <input
          className="tab-rename-input"
          value={renameValue}
          autoFocus
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setIsRenaming(false);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="tab-name">{tabName}</span>
      )}
      {isPlugin && pluginInstance?.badge != null && pluginInstance.badge > 0 && (
        <span style={{
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 9,
          fontWeight: 700,
          borderRadius: 8,
          padding: '0 4px',
          minWidth: 14,
          height: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          flexShrink: 0,
        }}>
          {pluginInstance.badge > 99 ? '99+' : pluginInstance.badge}
        </span>
      )}
      <button
        className="tab-close-btn"
        onClick={handleClose}
        title="Close"
      >
        {'\u00D7'}
      </button>
    </div>
  );
}
