import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useSettingsStore } from '../../store/settingsStore';
import { activateTerminalLink } from '../../lib/terminalLinks';
import type { TerminalSnapshot } from '../../lib/terminalSharing';
import { terminalTheme } from '../../lib/terminalTheme';

interface Props {
  deviceId: string;
  panelId: string;
  connected: boolean;
  refreshKey: number;
}

export function RemoteTerminalView({ deviceId, panelId, connected, refreshKey }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const previous = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
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
    if (!connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
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
        setLoaded(true);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        // Completion-based polling guarantees at most one outstanding read.
        if (!cancelled) timer = setTimeout(() => void refresh(), 500);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [deviceId, panelId, connected, refreshKey]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#1a1a2e' }}>
      {!loaded && !error && connected && <div style={{ padding: 10, color: 'var(--text-muted)' }}>Loading terminal screen…</div>}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} aria-label="Remote terminal screen">
        <div ref={container} style={{ width: 'max-content', minWidth: '100%' }} />
      </div>
      {error && <div role="alert" style={{ padding: 10, color: '#ff6b6b', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
