import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useSettingsStore } from '../../store/settingsStore';
import { activateTerminalLink } from '../../lib/terminalLinks';
import type { TerminalSnapshot, TerminalViewport } from '../../lib/terminalSharing';
import { RemoteTerminalStream } from '../../lib/remoteTerminalStream';
import { panelTerminalTheme, watchTerminalBackground } from '../../lib/terminalTheme';
import { remotePanelId } from '../../store/lanStore';
import { onTerminalUserData, RemoteTerminalInput } from '../../lib/remoteTerminalInput';

interface Props {
  deviceId: string;
  panelId: string;
  connected: boolean;
  inputSupported: boolean;
  registryReady?: boolean;
  refreshKey: number;
  streamSupported?: boolean;
  focused?: boolean;
  onHistory?: () => void;
}

export function RemoteTerminalView({ deviceId, panelId, connected, inputSupported, registryReady = true, refreshKey,
  streamSupported = false, focused = false, onHistory }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const desired = useRef<{ cols: number; rows: number } | undefined>(undefined);
  const measureSize = useRef<(() => void) | null>(null);
  const control = useRef(crypto.randomUUID());
  const active = useRef(focused);
  active.current = focused;
  const requestUpdate = useRef<(() => void) | null>(null);
  const previous = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [controlling, setControlling] = useState(true);
  const [inputError, setInputError] = useState<string | null>(null);
  const fontSize = useSettingsStore(s => s.settings.fontSize);
  const fontFamily = useSettingsStore(s => s.settings.fontFamily);

  useEffect(() => {
    if (!container.current) return;
    const term = new Terminal({
      disableStdin: true, cursorBlink: false, scrollback: 2000,
      fontSize, fontFamily,
      theme: panelTerminalTheme(remotePanelId(deviceId,panelId)), allowTransparency: true,
      linkHandler: { activate: activateTerminalLink },
    });
    term.loadAddon(new WebLinksAddon(activateTerminalLink));
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container.current);
    const unwatchBackground = watchTerminalBackground(term,remotePanelId(deviceId,panelId));
    terminal.current = term;
    const measure = () => {
      const size = fit.proposeDimensions();
      if (!size || !viewport.current?.clientWidth || !viewport.current?.clientHeight) return;
      const next = { cols: Math.min(500, Math.max(2, size.cols)), rows: Math.min(300, Math.max(1, size.rows)) };
      if (desired.current?.cols !== next.cols || desired.current?.rows !== next.rows) {
        desired.current = next; requestUpdate.current?.();
      }
    };
    measureSize.current = measure;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    measure();
    previous.current = '';
    setLoaded(false);
    setError(null);
    return () => { observer.disconnect(); measureSize.current = null; unwatchBackground(); terminal.current = null; term.dispose(); };
  }, [deviceId, panelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontSize = fontSize;
    terminal.current.options.fontFamily = fontFamily;
    measureSize.current?.();
  }, [fontSize, fontFamily]);

  useEffect(() => {
    if (focused) { control.current = crypto.randomUUID(); requestUpdate.current?.(); }
  }, [focused]);

  useEffect(() => {
    const term = terminal.current;
    const node = container.current;
    if (!term || !node) return;
    term.options.disableStdin = true;
    setInputError(null);
    if (!connected) return;
    let cancelled = false;
    let refreshing = false;
    let refreshPending = false;
    let timer: ReturnType<typeof setTimeout>;
    const stream = new RemoteTerminalStream(term);
    let session: string | null | undefined;
    let connectionId: string | undefined;
    let failed = false;
    const requestRefresh = () => {
      if (cancelled) return;
      if (refreshing) { refreshPending = true; return; }
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 0);
    };
    requestUpdate.current = requestRefresh;
    const input = new RemoteTerminalInput(
      (target, data) => invoke('lan_terminal_input', { ...target, data }),
      message => { setInputError(message); term.options.disableStdin = true; },
      requestRefresh,
    );
    let userData: { dispose(): void } | undefined;
    try {
      userData = onTerminalUserData(term, data => {
        if (input.ready) { term.scrollToBottom(); input.enqueue(data); }
      });
    } catch (err) { setInputError(String(err)); }

    const copy = () => {
      const selection = term.getSelection();
      if (!selection) return false;
      void navigator.clipboard.writeText(selection).catch(err => setInputError(`Copy failed: ${err}`));
      return true;
    };
    const paste = () => {
      if (!input.ready) return;
      const lease = input.lease;
      void navigator.clipboard.readText().then(text => {
        if (text && !cancelled && input.ready && lease === input.lease) term.paste(text);
      }).catch(err => { if (!cancelled) setInputError(`Paste failed: ${err}`); });
    };
    // Match local-terminal shortcuts, leaving app navigation to App.tsx.
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === 'tab') return false;
      if (event.ctrlKey && key === 'c') {
        if (copy() || event.shiftKey) { event.preventDefault(); return false; }
      }
      if (event.ctrlKey && event.shiftKey && key === 'a') {
        event.preventDefault(); term.selectAll(); return false;
      }
      if ((event.ctrlKey && key === 'v') || (event.shiftKey && key === 'insert')) {
        event.preventDefault(); paste(); return false;
      }
      return true;
    });
    const nativePaste = (event: ClipboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      const text = event.clipboardData?.getData('text/plain');
      if (text && input.ready) term.paste(text);
    };
    const contextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (!copy()) paste();
    };
    node.addEventListener('paste', nativePaste, true);
    node.addEventListener('contextmenu', contextMenu);
    const refresh = async () => {
      refreshing = true;
      refreshPending = false;
      failed = false;
      try {
        const requestedViewport: TerminalViewport | undefined = active.current && desired.current && session
          && document.visibilityState === 'visible'
          ? { ...desired.current, inputSession: session, controlId: control.current } : undefined;
        const snapshot = await invoke<TerminalSnapshot>('lan_read_terminal', { deviceId, panelId, connectionId,
          ...(streamSupported ? { options: { stream: true, cursor: stream.cursor, viewport: requestedViewport } } : {}) });
        const term = terminal.current;
        if (cancelled || !term) return;
        if (snapshot?.kind !== 'terminal' && snapshot?.kind !== 'terminalDelta') {
          throw new Error('Update Tessera on the host computer to share terminal screens.');
        }
        if (typeof snapshot.data !== 'string' || !Number.isInteger(snapshot.cols) || !Number.isInteger(snapshot.rows)
          || snapshot.cols < 2 || snapshot.rows < 1 || snapshot.cols > 4096 || snapshot.rows > 4096) {
          throw new Error('The host sent an invalid terminal screen.');
        }
        const serialized = JSON.stringify(snapshot);
        if (streamSupported || serialized !== previous.current) {
          await stream.apply(snapshot);
          if (cancelled) return;
          previous.current = serialized;
        }
        session = snapshot.inputSession;
        connectionId = snapshot.connectionId;
        setControlling(!requestedViewport || snapshot.controlling !== false);
        input.setTarget(registryReady && inputSupported && userData && snapshot.inputSession && snapshot.connectionId
          ? { deviceId, panelId, inputSession: snapshot.inputSession, connectionId: snapshot.connectionId }
          : null);
        term.options.disableStdin = !input.ready;
        setLoaded(true);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          failed = true;
          // A restart revokes the previous PTY's resize/input lease. Obtain
          // a fresh stream first, without repeating an obsolete resize.
          session = undefined; connectionId = undefined;
          // A busy host can temporarily withhold a synchronized frame. Keep
          // the last verified input lease so Ctrl+C still works; the backend
          // rejects it if the PTY or connection has since been replaced.
          setError(String(err));
        }
      } finally {
        // Completion-based polling guarantees at most one outstanding read.
        refreshing = false;
        if (!cancelled) timer = setTimeout(() => void refresh(), failed ? 750 : refreshPending ? 0 : streamSupported ? 50 : 500);
      }
    };
    void refresh();
    return () => {
      cancelled = true; clearTimeout(timer); input.dispose(); userData?.dispose();
      requestUpdate.current = null;
      term.options.disableStdin = true;
      term.attachCustomKeyEventHandler(() => true);
      node.removeEventListener('paste', nativePaste, true);
      node.removeEventListener('contextmenu', contextMenu);
    };
  }, [deviceId, panelId, connected, inputSupported, registryReady, refreshKey, streamSupported]);

  return (
    <div className="remote-terminal" onPointerDownCapture={() => {
      if (focused) { control.current = crypto.randomUUID(); requestUpdate.current?.(); }
    }} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      {!loaded && !error && connected && <div style={{ padding: 10, color: 'var(--text-muted)' }}>Loading terminal screen…</div>}
      <div ref={viewport} style={{ flex: 1, minHeight: 0, overflow: 'auto' }} aria-label="Remote terminal screen">
        <div ref={container} style={{ width: '100%', height: '100%' }} />
      </div>
      {connected && registryReady && focused && !streamSupported && <div role="status" className="remote-terminal-notice">
        Update Tessera on the host PC for a shared terminal that fits this panel.
        <button className="btn btn-secondary" onClick={onHistory}>Open conversation history</button>
      </div>}
      {connected && focused && streamSupported && !controlling && <div role="status" className="remote-terminal-notice">
        Another view controls the terminal size. Click here to take control.
      </div>}
      {connected && !registryReady && <div role="status" style={{ padding: 8, color: 'var(--text-muted)', fontSize: 12 }}>
        Checking terminal access with the host…
      </div>}
      {connected && registryReady && !inputSupported && <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 12 }}>
        Read-only. This host has not enabled direct terminal typing. Check that both computers are running the latest Tessera build.
      </div>}
      {error && <div role="alert" style={{ padding: 10, color: '#ff6b6b', fontSize: 12 }}>{error}</div>}
      {inputError && <div role="alert" style={{ padding: 10, color: '#ff6b6b', fontSize: 12 }}>{inputError}</div>}
    </div>
  );
}
