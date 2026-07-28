import { useEffect, useRef, useCallback } from 'react';
import { X, Puzzle, AlertTriangle, RefreshCw } from 'lucide-react';
import { usePluginStore } from '../../store/pluginStore';
import { useLayoutStore } from '../../store/layoutStore';
import { createBridge, type PluginBridge } from './PluginSDKBridge';
import { PLUGIN_SDK_SOURCE } from '../../lib/pluginSDK';

// ─── Module-Level Bridge Registry ───────────────────────────────────────────
// Keeps bridge references alive across React strict-mode double-mounts.
// Anchored to globalThis so it survives Vite HMR re-evaluation.

const bridgeRegistry: Map<string, PluginBridge> =
  (globalThis as Record<string, unknown>).__pluginBridgeRegistry as Map<string, PluginBridge> ??
  ((globalThis as Record<string, unknown>).__pluginBridgeRegistry = new Map<string, PluginBridge>());

// ─── Render a Lucide icon by name (subset of common icons) ─────────────────
// For custom toolbar buttons from the manifest. Only a handful of icons are
// supported inline; the rest fall back to Puzzle.

function ToolbarIcon({ name, size = 14 }: { name: string; size?: number }) {
  // We just render the name as a title attribute on a generic icon.
  // A real implementation would dynamically import from lucide-react.
  // For now, all custom buttons use the Puzzle icon.
  return <Puzzle size={size} aria-label={name} />;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface PluginPanelProps {
  instanceId: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PluginPanel({ instanceId }: PluginPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<PluginBridge | null>(null);

  // Read plugin instance data
  const pluginInstance = usePluginStore((s) => s.instances.get(instanceId));
  const pluginName = pluginInstance?.pluginName;
  const manifest = usePluginStore((s) =>
    pluginName ? s.registry.get(pluginName) : undefined
  );

  const removePanel = useLayoutStore((s) => s.removePanel);
  const destroyInstance = usePluginStore((s) => s.destroyInstance);

  // ─── Close handler ─────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    const bridge = bridgeRef.current ?? bridgeRegistry.get(instanceId);
    if (bridge) {
      // Send destroy, wait 500ms, then clean up
      bridge.sendDestroy().then(() => {
        bridge.destroy();
        bridgeRegistry.delete(instanceId);
      });
    }
    destroyInstance(instanceId);
    removePanel(instanceId);
  }, [instanceId, removePanel, destroyInstance]);

  // ─── Toolbar button handler ────────────────────────────────────────────

  const handleToolbarButton = useCallback((buttonId: string) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    // Send toolbar button event to the plugin
    iframe.contentWindow.postMessage({
      type: 'sdk:event',
      event: 'toolbar:button',
      data: { buttonId },
    }, '*');
  }, []);

  // ─── iframe onLoad: inject SDK and initialize bridge ──────────────────

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !pluginName) return;

    // Inject SDK script into the iframe
    try {
      const doc = iframe.contentWindow.document;
      const script = doc.createElement('script');
      script.textContent = PLUGIN_SDK_SOURCE;
      doc.head.appendChild(script);
    } catch {
      // Cross-origin restriction — the SDK won't be injectable via DOM.
      // Instead, the plugin must include the SDK script tag themselves,
      // or we need a custom protocol that injects it server-side.
      console.warn(`[PluginPanel:${instanceId}] Cannot inject SDK into iframe (cross-origin)`);
    }

    // Create bridge (or reuse existing one)
    let bridge = bridgeRegistry.get(instanceId);
    if (bridge) {
      bridge.destroy();
    }
    bridge = createBridge(instanceId, pluginName, iframe);
    bridgeRegistry.set(instanceId, bridge);
    bridgeRef.current = bridge;

    // Send init message
    bridge.sendInit();
  }, [instanceId, pluginName]);

  // ─── Stale plugin panel auto-removal ──────────────────────────────────
  // If the plugin instance was not recreated after app restart (layout
  // persisted but pluginStore instances did not), auto-remove the panel.

  useEffect(() => {
    if (!pluginInstance) {
      removePanel(instanceId);
    }
  }, [pluginInstance, instanceId, removePanel]);

  // ─── Cleanup on unmount ────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      // Only destroy if the bridge is still in the registry — handleClose
      // may have already removed it, and double-destroying would be wasteful.
      if (!bridgeRegistry.has(instanceId)) return;
      const bridge = bridgeRef.current ?? bridgeRegistry.get(instanceId);
      if (bridge) {
        bridge.sendDestroy().then(() => {
          bridge.destroy();
          bridgeRegistry.delete(instanceId);
        });
      }
    };
  }, [instanceId]);

  // ─── Error: plugin not found ──────────────────────────────────────────

  if (!pluginInstance) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-primary)',
      }}>
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
          <span style={{ color: 'var(--error)', display: 'flex', alignItems: 'center' }}>
            <AlertTriangle size={14} />
          </span>
          <span style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            Plugin Not Found
          </span>
          <button
            onClick={handleClose}
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
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          color: 'var(--text-muted)',
          fontSize: 13,
        }}>
          <AlertTriangle size={24} />
          <span>Plugin instance not found in registry</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>ID: {instanceId}</span>
        </div>
      </div>
    );
  }

  // ─── Build iframe URL ─────────────────────────────────────────────────

  const entry = manifest?.entry ?? 'index.html';
  const iframeSrc = manifest?.builtin
    ? `/plugins/${pluginName}/${entry}`
    : `subapp://${pluginName}/${entry}`;

  // ─── Determine title and icon ─────────────────────────────────────────

  const title = pluginInstance.title;
  const titleButtons = manifest?.titleButtons ?? [];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-primary)',
    }}>
      {/* Toolbar */}
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
        {/* Plugin icon */}
        <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
          <Puzzle size={14} />
        </span>

        {/* Plugin title */}
        <span style={{
          flex: 1,
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {title}
        </span>

        {/* Badge */}
        {pluginInstance.badge != null && pluginInstance.badge > 0 && (
          <span style={{
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 10,
            padding: '1px 6px',
            minWidth: 16,
            textAlign: 'center',
            lineHeight: '16px',
          }}>
            {pluginInstance.badge > 99 ? '99+' : pluginInstance.badge}
          </span>
        )}

        {/* Custom title buttons from manifest */}
        {titleButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={(e) => {
              e.stopPropagation();
              handleToolbarButton(btn.id);
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
            title={btn.tooltip ?? btn.label}
          >
            <ToolbarIcon name={btn.icon} size={14} />
          </button>
        ))}

        {/* Reload button (for development) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            const iframe = iframeRef.current;
            if (iframe) {
              try { iframe.contentWindow?.location.reload(); } catch { /* cross-origin */ }
            }
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
          title="Reload plugin"
        >
          <RefreshCw size={13} />
        </button>

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
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
          title="Close plugin"
        >
          <X size={14} />
        </button>
      </div>

      {/* iframe — fills remaining space */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          onLoad={handleIframeLoad}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            background: 'var(--bg-primary)',
          }}
          title={`Plugin: ${title}`}
        />
        {/* Fallback overlay shown if the iframe URL can't be resolved (non-builtin only) */}
        {!manifest?.builtin && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: 'var(--bg-primary)',
              color: 'var(--text-muted)',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            <Puzzle size={32} style={{ opacity: 0.4 }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {title}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                Plugin loaded &mdash; waiting for custom protocol registration
              </div>
              <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
                {iframeSrc}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
