import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useSettingsStore } from '../../store/settingsStore';
import { activateTerminalLink } from '../../lib/terminalLinks';
import type { TerminalSnapshot } from '../../lib/terminalSharing';
import { terminalTheme } from '../../lib/terminalTheme';
import { onTerminalUserData, RemoteTerminalInput } from '../../lib/remoteTerminalInput';

interface Props {
  deviceId: string;
  panelId: string;
  connected: boolean;
  inputSupported: boolean;
  refreshKey: number;
}

export function RemoteTerminalView({ deviceId, panelId, connected, inputSupported, refreshKey }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const previous = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const fontSize = useSettingsStore(s => s.settings.fontSize);
  const fontFamily = useSettingsStore(s => s.settings.fontFamily);

  useEffect(() => {
    if (!container.current) return;
    const term = new Terminal({
      disableStdin: true, cursorBlink: false, scrollback: 2000,
      fontSize, fontFamily,
      theme: terminalTheme,
      linkHandler: { activate: activateTerminalLink },
    });
    term.loadAddon(new WebLinksAddon(activateTerminalLink));
    term.open(container.current);
    terminal.current = term;
    previous.current = '';
    setLoaded(false);
    setError(null);
    return () => { terminal.current = null; term.dispose(); };
  }, [deviceId, panelId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontSize = fontSize;
    terminal.current.options.fontFamily = fontFamily;
  }, [fontSize, fontFamily]);

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
    const requestRefresh = () => {
      if (cancelled) return;
      if (refreshing) { refreshPending = true; return; }
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 0);
    };
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
      try {
        const snapshot = await invoke<TerminalSnapshot>('lan_read_terminal', { deviceId, panelId });
        const term = terminal.current;
        if (cancelled || !term) return;
        if (snapshot?.kind !== 'terminal') {
          throw new Error('Update Tessera on the host computer to share terminal screens.');
        }
        if (typeof snapshot.data !== 'string' || !Number.isInteger(snapshot.cols) || !Number.isInteger(snapshot.rows)
          || snapshot.cols < 2 || snapshot.rows < 1 || snapshot.cols > 4096 || snapshot.rows > 4096) {
          throw new Error('The host sent an invalid terminal screen.');
        }
        const serialized = JSON.stringify(snapshot);
        if (serialized !== previous.current) {
          const buffer = term.buffer.active;
          const following = buffer.viewportY >= buffer.baseY;
          const offset = buffer.baseY - buffer.viewportY;
          term.options.windowsPty = snapshot.windowsPty;
          // The owner controls geometry. Fitting a remote tile would corrupt
          // cursor addressing or resize the terminal on the other computer.
          term.resize(snapshot.cols, snapshot.rows);
          await new Promise<void>(resolve => term.write(`\x1bc\x1b[?2026h${snapshot.data}\x1b[?2026l`, () => {
            if (!cancelled) {
              if (following) term.scrollToBottom();
              else term.scrollToLine(Math.max(0, term.buffer.active.baseY - offset));
            }
            resolve();
          }));
          if (cancelled) return;
          previous.current = serialized;
        }
        input.setTarget(inputSupported && userData && snapshot.inputSession && snapshot.connectionId
          ? { deviceId, panelId, inputSession: snapshot.inputSession, connectionId: snapshot.connectionId }
          : null);
        term.options.disableStdin = !input.ready;
        setLoaded(true);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          // A busy host can temporarily withhold a synchronized frame. Keep
          // the last verified input lease so Ctrl+C still works; the backend
          // rejects it if the PTY or connection has since been replaced.
          setError(String(err));
        }
      } finally {
        // Completion-based polling guarantees at most one outstanding read.
        refreshing = false;
        if (!cancelled) timer = setTimeout(() => void refresh(), refreshPending ? 0 : 500);
      }
    };
    void refresh();
    return () => {
      cancelled = true; clearTimeout(timer); input.dispose(); userData?.dispose();
      term.options.disableStdin = true;
      term.attachCustomKeyEventHandler(() => true);
      node.removeEventListener('paste', nativePaste, true);
      node.removeEventListener('contextmenu', contextMenu);
    };
  }, [deviceId, panelId, connected, inputSupported, refreshKey]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#1a1a2e' }}>
      {!loaded && !error && connected && <div style={{ padding: 10, color: 'var(--text-muted)' }}>Loading terminal screen…</div>}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} aria-label="Remote terminal screen">
        <div ref={container} style={{ width: 'max-content', minWidth: '100%' }} />
      </div>
      {connected && !inputSupported && <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 12 }}>
        Read-only. Update Tessera on the host computer to enable direct terminal typing.
      </div>}
      {error && <div role="alert" style={{ padding: 10, color: '#ff6b6b', fontSize: 12 }}>{error}</div>}
      {inputError && <div role="alert" style={{ padding: 10, color: '#ff6b6b', fontSize: 12 }}>{inputError}</div>}
    </div>
  );
}
