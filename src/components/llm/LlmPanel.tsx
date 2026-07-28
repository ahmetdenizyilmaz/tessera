import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useLlmChatStore } from '../../store/llmChatStore';
import { invoke } from '@tauri-apps/api/core';
import { LLM_PROVIDERS } from '../../types/llmProviders';
import type { LlmProvider } from '../../types/instance';
import { ColorPickerPopover } from '../dialogs/ColorPickerPopover';
import LlmChatView from './LlmChatView';
import openaiIcon from '../../assets/openai-icon.png';
import geminiIcon from '../../assets/gemini-icon.png';
import ollamaIcon from '../../assets/ollama-icon.svg';
import lmstudioIcon from '../../assets/lmstudio-icon.png';

const PROVIDER_IMAGES: Record<string, string> = {
  openai: openaiIcon,
  gemini: geminiIcon,
  ollama: ollamaIcon,
  lmstudio: lmstudioIcon,
};

interface LlmPanelProps {
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

export function LlmPanel({ instanceId }: LlmPanelProps) {
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const removePanel = useLayoutStore((s) => s.removePanel);
  const removeInstance = useInstanceStore((s) => s.removeInstance);
  const setName = useInstanceStore((s) => s.setName);
  const setColor = useInstanceStore((s) => s.setColor);

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerAnchorRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const llmConfig = instance?.config.llmConfig;
  const provider = llmConfig?.provider as Exclude<LlmProvider, 'claude'> | undefined;
  const providerMeta = provider ? LLM_PROVIDERS[provider] : null;

  // Mark as running once created
  useEffect(() => {
    if (instance?.status === 'starting') {
      useInstanceStore.getState().setStatus(instanceId, 'running');
    }
  }, [instance?.status, instanceId]);

  // Stale panel auto-removal
  useEffect(() => {
    if (!instance) {
      removePanel(instanceId);
    }
  }, [instance, instanceId, removePanel]);

  const handleClose = useCallback(async () => {
    try {
      await invoke('llm_destroy_session', { id: instanceId });
    } catch {
      // Session may not exist
    }
    useLlmChatStore.getState().removeConversation(instanceId);
    removePanel(instanceId);
    removeInstance(instanceId);
  }, [instanceId, removePanel, removeInstance]);

  // Rename
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

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Context menu
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
    [instanceId, setColor],
  );

  useEffect(() => {
    if (!contextMenu) return;
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
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

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
      <div
        className="terminal-toolbar"
        style={colorStyles.toolbar}
        onContextMenu={handleContextMenu}
      >
        <div className="terminal-toolbar-left">
          <div className="color-dot" style={{ backgroundColor: instance.color }} />

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
            {statusLabels[instance.status] ?? instance.status}
          </span>

          {/* Provider + model inline */}
          {providerMeta && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 13,
                color: 'var(--text-muted)',
                marginLeft: 4,
              }}
            >
              <img src={PROVIDER_IMAGES[provider ?? 'openai']} alt="" style={{ width: 14, height: 14, borderRadius: 2 }} />
              {providerMeta.displayName}
              {llmConfig?.model && (
                <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4, position: 'relative', top: 1 }}>
                  {llmConfig.model}
                </span>
              )}
            </span>
          )}
          {!providerMeta && llmConfig?.model && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
              {llmConfig.model}
            </span>
          )}
        </div>

        <div className="toolbar-actions">
          <button
            className="toolbar-btn close"
            onClick={handleClose}
            title="Close LLM chat"
          >
            {'\u00D7'}
          </button>
        </div>
      </div>

      {/* Content area: just chat */}
      <div className="terminal-content" style={{ display: 'flex' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div className="view-layer visible">
            <LlmChatView instanceId={instanceId} />
          </div>
        </div>
      </div>

      {/* Context menu */}
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
