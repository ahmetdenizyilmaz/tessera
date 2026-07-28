import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { cleanupPty } from '../../hooks/usePty';
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



export function TerminalPanel({ instanceId }: TerminalPanelProps) {
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const removePanel = useLayoutStore((s) => s.removePanel);
  const removeInstance = useInstanceStore((s) => s.removeInstance);
  const setName = useInstanceStore((s) => s.setName);
  const setColor = useInstanceStore((s) => s.setColor);

  // The panel's view is chosen at creation time and fixed for the session's
  // lifetime — chat and terminal are separate Claude sessions by design.
  const panelView = instance?.config?.panelView ?? 'chat';
  const [showCheckpoints, setShowCheckpoints] = useState(false);

  // Compact toolbar: below this panel width all controls collapse into ☰ —
  // one threshold, one mechanism, no per-element breakpoints
  const COMPACT_TOOLBAR_WIDTH = 430;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [showToolbarMenu, setShowToolbarMenu] = useState(false);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const check = () => setCompact(el.clientWidth < COMPACT_TOOLBAR_WIDTH);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!compact) setShowToolbarMenu(false);
  }, [compact]);

  // Terminal panels: capture the session id the interactive CLI creates
  // (the CLI doesn't report it, so we watch the project's session files).
  // Needed so a restart can --resume the terminal conversation.
  useEffect(() => {
    if (panelView !== 'terminal') return;
    const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    let mounted = true;
    let attempts = 0;

    const tryScan = () => {
      if (!mounted) return;
      const inst = useInstanceStore.getState().instances.get(instanceId);
      if (!inst || inst.claudeSessionId) return;
      const cwd = inst.config.cwd;
      if (!cwd) return;
      attempts++;
      invoke<Array<{ sessionId: string; project: string; timestamp: number; hasFile: boolean }>>('session_scan_all')
        .then((sessions) => {
          if (!mounted) return;
          const cur = useInstanceStore.getState().instances.get(instanceId)?.claudeSessionId;
          if (cur) return;
          const cwdNorm = normPath(cwd);
          const match = sessions
            .filter((s) => normPath(s.project) === cwdNorm && s.hasFile)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
          if (match) {
            useInstanceStore.getState().setClaudeSessionId(instanceId, match.sessionId);
          } else if (attempts < 10) {
            setTimeout(tryScan, 3000);
          }
        })
        .catch(() => {
          if (attempts < 10 && mounted) setTimeout(tryScan, 3000);
        });
    };

    const timer = setTimeout(tryScan, 2500);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [instanceId, panelView]);
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
      // Clicks inside the color popover belong to it — closing here would
      // unmount the swatch before its own click handler can fire
      const target = e.target as Element | null;
      if (target?.closest?.('.color-picker-popover')) return;
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

  // Toolbar controls — rendered inline when there's room, inside the ☰ menu
  // when the panel is narrow
  const statusBadge = (
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
  );

  const modelSelect = (
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
  );

  const thinkingSelect = (
    <ThinkingModeSelector
      instanceId={instanceId}
      value={thinkingMode}
      onChange={setThinkingMode}
    />
  );

  const checkpointsBtn = (
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
  );

  return (
    <div className="terminal-panel" style={colorStyles.panel}>
      {/* Toolbar with color-tinted background */}
      <div
        ref={toolbarRef}
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

          {!compact && statusBadge}
        </div>

        {/* Right side: full controls, or a single ☰ menu when narrow.
            Terminal panels manage model/thinking inside the CLI itself, so
            they only carry the status. */}
        <div className="toolbar-actions">
          {compact ? (
            <div style={{ position: 'relative' }}>
              <button
                className="toolbar-btn"
                onClick={() => setShowToolbarMenu((v) => !v)}
                title="Panel controls"
                style={{ color: showToolbarMenu ? 'var(--accent)' : undefined }}
              >
                {'☰'}
              </button>
              {showToolbarMenu && (
                <div className="toolbar-menu" onMouseLeave={() => setShowToolbarMenu(false)}>
                  <div className="toolbar-menu-row">{statusBadge}</div>
                  {panelView === 'chat' && (
                    <>
                      <div className="toolbar-menu-row">{checkpointsBtn}</div>
                      <div className="toolbar-menu-row">{modelSelect}{thinkingSelect}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : panelView === 'chat' ? (
            <>
              {modelSelect}
              {thinkingSelect}
              {checkpointsBtn}
            </>
          ) : null}
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

      {/* Content area: one fixed view per panel (chosen at creation) */}
      <div className="terminal-content" style={{ display: 'flex' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div className="view-layer visible">
            {panelView === 'chat' ? (
              <ChatView instanceId={instanceId} isVisible />
            ) : (
              <XTermView instanceId={instanceId} isVisible />
            )}
          </div>
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
