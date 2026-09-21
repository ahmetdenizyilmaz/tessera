import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Terminal, ITerminalOptions } from '@xterm/xterm';
import type { SerializeAddon } from '@xterm/addon-serialize';

export interface TerminalSnapshot {
  kind: 'terminal';
  cols: number;
  rows: number;
  data: string;
  windowsPty?: ITerminalOptions['windowsPty'];
}

const sources = new Map<string, () => Promise<TerminalSnapshot>>();
const MAX_SNAPSHOT_BYTES = 800 * 1024;

/** Share the rendered VT state, never a truncated tail of raw PTY output. */
export function registerSharedTerminal(id: string, terminal: Terminal, serializer: SerializeAddon) {
  let alive = true;
  const snapshot = async (): Promise<TerminalSnapshot> => {
    // Drain queued writes before serializing, including split escape sequences.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Terminal renderer did not finish updating.')), 4000);
      terminal.write('', () => { clearTimeout(timer); resolve(); });
    });
    if (!alive) return readSharedTerminal(id);
    if (terminal.modes.synchronizedOutputMode) throw new Error('Terminal is updating; waiting for a complete frame.');
    let scrollback = 2000;
    for (;;) {
      const result: TerminalSnapshot = {
        kind: 'terminal', cols: terminal.cols, rows: terminal.rows,
        data: serializer.serialize({ scrollback }), windowsPty: terminal.options.windowsPty,
      };
      if (new TextEncoder().encode(JSON.stringify(result)).length <= MAX_SNAPSHOT_BYTES) return result;
      if (!scrollback) throw new Error('The terminal screen is too large to share.');
      scrollback = Math.floor(scrollback / 2);
    }
  };
  sources.set(id, snapshot);
  return () => {
    alive = false;
    if (sources.get(id) === snapshot) sources.delete(id);
  };
}

export async function readSharedTerminal(id: string): Promise<TerminalSnapshot> {
  const source = sources.get(id);
  if (!source) throw new Error('Terminal has not started. Open this panel on the host computer first.');
  return source();
}

export async function initTerminalSharing() {
  return listen<{ requestId: string; panelId: string }>('lan-terminal-read', async ({ payload }) => {
    let snapshot: TerminalSnapshot | null = null;
    let error: string | null = null;
    try { snapshot = await readSharedTerminal(payload.panelId); }
    catch (err) { error = String(err); }
    await invoke('lan_terminal_snapshot_result', { requestId: payload.requestId, snapshot, error })
      .catch(err => console.error('[LAN] terminal snapshot response failed:', err));
  });
}
