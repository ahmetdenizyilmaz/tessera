import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { cleanupPty, isPtySpawned } from '../../hooks/usePty';
import { destroyTerminal } from '../../hooks/useTerminal';
import { invoke } from '@tauri-apps/api/core';
import { XTermView, clearTerminalState } from './XTermView';
import ChatView from '../chat/ChatView';
import { ColorPickerPopover } from '../dialogs/ColorPickerPopover';
import { History } from 'lucide-react';
import CheckpointTimeline from '../checkpoints/CheckpointTimeline';
import { ThinkingModeSelector } from '../chat/ThinkingModeSelector';
import type { ThinkingMode } from '../chat/ThinkingModeSelector';

// CLI model aliases — the claude CLI resolves these to the current model ids
const CLAUDE_MODELS = [
  'sonnet',
  'opus',
  'fable',
  'haiku',
];

interface TerminalPanelProps {
  instanceId: string;
}

const statusColors: Record<string, string> = {
  starting: '#ffd43b',
  running: '#51cf66',
  stopped: '#a0a0a0',
  error: '#ff6b6b',
};

const statusLabels: Record<string, string> = {
  starting: 'Starting',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type ViewMode = 'chat' | 'terminal';

export function TerminalPanel({ instanceId }: TerminalPanelProps) {
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const removePanel = useLayoutStore((s) => s.removePanel);
  const removeInstance = useInstanceStore((s) => s.removeInstance);
  const setName = useInstanceStore((s) => s.setName);
  const setColor = useInstanceStore((s) => s.setColor);

  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  // Lazy PTY: the interactive claude terminal only spawns once the Terminal
  // tab is first opened (N chat-only panels must not mean N idle claude.exe).
  // Initializer checks isPtySpawned so a group-move remount keeps the terminal.
  const [termMounted, setTermMounted] = useState(() => isPtySpawned(instanceId));
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('auto');
  const setModel = useInstanceStore((s) => s.setModel);

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setModel(instanceId, newModel);
    invoke('stream_set_model', { id: instanceId, model: newModel }).catch(() => {});
  }, [instanceId, setModel]);

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerAnchorRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Stale panel auto-removal
  useEffect(() => {
    if (!instance) {
      removePanel(instanceId);
    }
  }, [instance, instanceId, removePanel]);

  const handleClose = useCallback(async () => {
    clearTerminalState(instanceId);
    cleanupPty(instanceId);
    destroyTerminal(instanceId);
    try {
      await invoke('pty_kill', { id: instanceId });
    } catch {
      // PTY may already be dead
    }
    try {
      await invoke('stream_kill', { id: instanceId });
    } catch {
      // Stream may already be dead
    }
    removePanel(instanceId);
    removeInstance(instanceId);
  }, [instanceId, removePanel, removeInstance]);

  // ── Rename ──
  const startRename = useCallback(() => {
    setRenameValue(instance?.name || '');
    setIsRenaming(true);
    setContextMenu(null);
  }, [instance?.name]);

  const submitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== instance?.name) {
      setName(instanceId, trimmed);
    }
    setIsRenaming(false);
  }, [renameValue, instance?.name, instanceId, setName]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
  }, []);

  // Focus rename input when it appears
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // ── Context menu ──
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
    setShowColorPicker(false);
  }, []);

  const handleColorChange = useCallback(
    (color: string) => {
      setColor(instanceId, color);
      setShowColorPicker(false);
      setContextMenu(null);
    },
    [instanceId, setColor]
  );

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    let cleaned = false;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
        setShowColorPicker(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setShowColorPicker(false);
      }
    };
    const timer = setTimeout(() => {
      if (cleaned) return;
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      cleaned = true;
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Color-tinted toolbar styles
  const colorStyles = useMemo(() => {
    const color = instance?.color || '#4a9eff';
    return {
      panel: {
        borderTop: `2px solid ${color}`,
      } as React.CSSProperties,
      toolbar: {
        background: hexToRgba(color, 0.08),
        borderBottom: `1px solid ${hexToRgba(color, 0.2)}`,
      } as React.CSSProperties,
    };
  }, [instance?.color]);

  if (!instance) return null;

  return (
    <div className="terminal-panel" style={colorStyles.panel}>
      {/* Toolbar with color-tinted background */}
      <div
        className="terminal-toolbar"
        style={colorStyles.toolbar}
        onContextMenu={handleContextMenu}
      >
        {/* Left side: color dot + name + status */}
        <div className="terminal-toolbar-left">
          <div className="color-dot" style={{ backgroundColor: instance.color }} />

          {/* Instance name (double-click to rename) */}
          {isRenaming ? (
            <div className="instance-name">
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                  if (e.key === 'Escape') cancelRename();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ) : (
            <span
              className="instance-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename();
              }}
              title="Double-click to rename"
            >
              {instance.name}
            </span>
          )}

          <span
            className="status-badge"
            style={{ color: statusColors[instance.status] ?? '#a0a0a0' }}
          >
            <span
              className="color-dot"
              style={{
                backgroundColor: statusColors[instance.status] ?? '#a0a0a0',
                width: 6,
                height: 6,
              }}
            />
            <span className="status-label">{statusLabels[instance.status] ?? instance.status}</span>
          </span>
        </div>

        {/* Right side: model selector + view toggle + close */}
        <div className="toolbar-actions">
          <select
            className="model-selector"
            value={instance.config.model}
            onChange={handleModelChange}
            title="Change model (applies to next message)"
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m}>{m.replace('claude-', '').replace(/-20\d+$/, '')}</option>
            ))}
          </select>
          <ThinkingModeSelector
            instanceId={instanceId}
            value={thinkingMode}
            onChange={setThinkingMode}
          />
          <div className="view-toggle">
            <button
              className={viewMode === 'chat' ? 'active' : ''}
              onClick={() => setViewMode('chat')}
            >
              Chat
            </button>
            <button
              className={viewMode === 'terminal' ? 'active' : ''}
              onClick={() => {
                setTermMounted(true);
                setViewMode('terminal');
              }}
            >
              Terminal
            </button>
          </div>

          <button
            className="toolbar-btn"
            onClick={() => setShowCheckpoints((p) => !p)}
            title="Checkpoints"
            style={{
              color: showCheckpoints ? 'var(--accent)' : undefined,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <History size={14} />
          </button>
        </div>

        {/* Close button always visible, outside toolbar-actions */}
        <button
          className="toolbar-btn close"
          onClick={handleClose}
          title="Close instance"
          style={{ flexShrink: 0, marginLeft: 4 }}
        >
          ×
        </button>
      </div>

      {/* Content area: all views stacked, toggle visibility via CSS classes */}
      <div className="terminal-content" style={{ display: 'flex' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Chat view */}
          <div className={`view-layer ${viewMode === 'chat' ? 'visible' : 'hidden'}`}>
            <ChatView instanceId={instanceId} isVisible={viewMode === 'chat'} />
          </div>

          {/* Terminal (xterm.js) — mounted on first Terminal-tab activation,
              then kept mounted so the PTY stays alive across tab switches */}
          {termMounted && (
            <div className={`view-layer ${viewMode === 'terminal' ? 'visible' : 'hidden'}`}>
              <XTermView instanceId={instanceId} isVisible={viewMode === 'terminal'} />
            </div>
          )}
        </div>

        {/* Checkpoint sidebar panel */}
        {showCheckpoints && (
          <div style={{
            width: 280, flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            overflow: 'hidden',
          }}>
            <CheckpointTimeline instanceId={instanceId} />
          </div>
        )}
      </div>

      {/* Context menu (right-click on toolbar) */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button className="context-menu-item" onClick={startRename}>
            Rename
          </button>
          <button
            ref={colorPickerAnchorRef}
            className="context-menu-item"
            onClick={() => setShowColorPicker(!showColorPicker)}
          >
            Change Color
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            style={{ color: 'var(--error)' }}
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      )}

      {/* Color picker popover (shown from context menu) */}
      <ColorPickerPopover
        isOpen={showColorPicker}
        onClose={() => {
          setShowColorPicker(false);
          setContextMenu(null);
        }}
        currentColor={instance.color}
        onColorChange={handleColorChange}
        anchorEl={colorPickerAnchorRef.current}
      />
    </div>
  );
}
