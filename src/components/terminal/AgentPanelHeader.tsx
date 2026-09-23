import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInstanceStore } from "../../store/instanceStore";
import { useLayoutStore } from "../../store/layoutStore";
import { ColorPickerPopover } from "../dialogs/ColorPickerPopover";
import { ProviderIcon } from "../icons/ProviderIcons";
import { GitFork } from "lucide-react";
import { PanelShortcutBadge } from '../layout/PanelShortcutBadge';

/** Shared panel chrome. Provider-specific controls stay inside the same menu. */
export function AgentPanelHeader({
  instanceId,
  status,
  statusColor,
  metadata,
  controls,
  onClose,
  onFork,
  onRestart,
  restarting,
  onStop,
}: {
  instanceId: string;
  status: string;
  statusColor: string;
  metadata: string;
  controls?: ReactNode;
  onClose: () => void;
  /** Continue this conversation in a new panel, possibly with another provider. */
  onFork?: () => void;
  onRestart?: () => void;
  restarting?: boolean;
  onStop?: () => void;
}) {
  const instance = useInstanceStore((s) => s.instances.get(instanceId));
  const isMaximized = useLayoutStore((s) => s.maximizedId === instanceId);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [menu, setMenu] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const [colorPicker, setColorPicker] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const colorAnchor = useRef<HTMLButtonElement>(null);
  const rename = () => {
    setName(instance?.name || "");
    setRenaming(true);
    setContext(null);
  };
  const submit = () => {
    if (name.trim())
      useInstanceStore.getState().setName(instanceId, name.trim());
    setRenaming(false);
  };
  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);
  useEffect(() => {
    if (!menu && !context && !colorPicker) return;
    const click = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest(".color-picker-popover")) return;
      if (!header.current?.contains(target)) {
        setMenu(false);
        setColorPicker(false);
      }
      if (!contextRef.current?.contains(target)) setContext(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        setContext(null);
        setColorPicker(false);
      }
    };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", click);
      document.removeEventListener("keydown", key);
    };
  }, [menu, context, colorPicker]);
  if (!instance) return null;
  return (
    <>
      <div
        ref={header}
        className="terminal-toolbar agent-panel-toolbar"
        style={{
          background: `${instance.color}14`,
          borderBottom: `1px solid ${instance.color}33`,
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContext({ x: event.clientX, y: event.clientY });
        }}
      >
        <div className="terminal-toolbar-left">
          <button
            ref={colorAnchor}
            type="button"
            className="agent-panel-color"
            title="Change Color"
            aria-label="Panel color"
            style={{ backgroundColor: instance.color }}
            onClick={() => setColorPicker((v) => !v)}
          />
          <div className="agent-panel-heading">
            <div className="panel-title-with-shortcut">
            {renaming ? (
              <div className="instance-name">
                <input
                  ref={input}
                  aria-label="Panel name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={submit}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") submit();
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setRenaming(false);
                    }
                  }}
                />
              </div>
            ) : (
              <span
                className="instance-name"
                title="Double-click to rename"
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  rename();
                }}
              >
                {instance.name}
              </span>
            )}
            <PanelShortcutBadge panelId={instanceId} />
            </div>
            <span
              className="agent-panel-metadata"
              title={`${metadata}\n${instance.config.cwd}`}
            >
              <span className="agent-panel-provider-icon" aria-hidden="true">
                <ProviderIcon
                  provider={
                    instance.config.agentProvider === "codex" ? "openai" : instance.config.agentProvider ?? "claude"
                  }
                  size={12}
                />
              </span>
              <span className="agent-panel-metadata-text">{metadata}</span>
            </span>
          </div>
        </div>
        <span
          className="status-badge agent-panel-status"
          title={status}
          style={{ color: statusColor }}
        >
          <span
            className="color-dot"
            style={{ backgroundColor: statusColor, width: 6, height: 6 }}
          />
          <span className="status-label">{status}</span>
        </span>
        <div className="toolbar-actions">
          {controls && (
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="toolbar-btn"
                title="Panel controls"
                aria-expanded={menu}
                onClick={() => setMenu((v) => !v)}
              >
                ☰
              </button>
              {menu && <div className="toolbar-menu">{controls}</div>}
            </div>
          )}
          {onStop && (
            <button
              type="button"
              className="toolbar-btn"
              title="Stop current turn"
              onClick={onStop}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <rect
                  x="2"
                  y="2"
                  width="8"
                  height="8"
                  rx="1"
                  fill="currentColor"
                />
              </svg>
            </button>
          )}
          {onRestart && (
            <button
              type="button"
              className="toolbar-btn"
              title="Restart agent (resume conversation)"
              disabled={restarting}
              onClick={onRestart}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M10.5 6a4.5 4.5 0 1 1-1.32-3.18"
                  stroke="currentColor"
                  strokeLinecap="round"
                />
                <path
                  d="M10.5 0.8V3.2H8.1"
                  stroke="currentColor"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {onFork && (
            <button
              type="button"
              className="toolbar-btn"
              title="Fork conversation into a new panel"
              onClick={onFork}
            >
              <GitFork size={12} />
            </button>
          )}
          <button
            type="button"
            className="toolbar-btn"
            title={
              isMaximized
                ? "Restore panel (show all)"
                : "Maximize panel (hide the others)"
            }
            onClick={() =>
              useLayoutStore.getState().toggleMaximized(instanceId)
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              {isMaximized ? (
                <>
                  <rect
                    x="0.5"
                    y="2.5"
                    width="7"
                    height="7"
                    stroke="currentColor"
                  />
                  <path d="M3.5 2.5V0.5H11.5V8.5H9.5" stroke="currentColor" />
                </>
              ) : (
                <rect
                  x="0.5"
                  y="0.5"
                  width="11"
                  height="11"
                  stroke="currentColor"
                />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="toolbar-btn close"
            title="Close instance"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
      {context && (
        <div
          ref={contextRef}
          className="context-menu"
          style={{ left: context.x, top: context.y }}
        >
          <button className="context-menu-item" onClick={rename}>
            Rename
          </button>
          {onFork && (
            <button
              className="context-menu-item"
              onClick={() => {
                setContext(null);
                onFork();
              }}
            >
              Fork conversation…
            </button>
          )}
          <button
            className="context-menu-item"
            onClick={() => {
              setContext(null);
              setColorPicker(true);
            }}
          >
            Change Color
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            style={{ color: "var(--error)" }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      )}
      <ColorPickerPopover
        isOpen={colorPicker}
        onClose={() => setColorPicker(false)}
        currentColor={instance.color}
        onColorChange={(color) => {
          useInstanceStore.getState().setColor(instanceId, color);
          setColorPicker(false);
        }}
        anchorEl={colorAnchor.current}
      />
    </>
  );
}
