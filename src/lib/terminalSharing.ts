import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Terminal, ITerminalOptions } from '@xterm/xterm';
import type { SerializeAddon } from '@xterm/addon-serialize';
import { TerminalJournal, type TerminalCursor, type TerminalEvent } from './terminalJournal';

export interface TerminalViewport { cols: number; rows: number; inputSession: string; controlId: string }
export interface TerminalReadOptions { stream?: boolean; cursor?: TerminalCursor; viewport?: TerminalViewport }

export interface TerminalSnapshot {
  kind: 'terminal' | 'terminalDelta';
  cols: number;
  rows: number;
  data: string;
  windowsPty?: ITerminalOptions['windowsPty'];
  /** Added by the host/backend, not by the renderer's serializer. */
  inputSession?: string | null;
  connectionId?: string;
  streamId?: string;
  sequence?: number;
  events?: TerminalEvent[];
  controlling?: boolean;
}

const sources = new Map<string, (options?: TerminalReadOptions) => Promise<TerminalSnapshot>>();
const previews = new Map<string, () => { text: string; terminal: boolean; fontSize: number; fontFamily: string }>();
export function readTerminalPreview(id: string) { return previews.get(id)?.(); }
const MAX_SNAPSHOT_BYTES = 800 * 1024;

/** Share the rendered VT state, never a truncated tail of raw PTY output. */
export function registerSharedTerminal(id: string, terminal: Terminal, serializer: Pick<SerializeAddon, 'serialize'>,
  sizing?: { setRemoteSize(size: TerminalViewport): Promise<void>; releaseRemoteSize(): void }) {
  let alive = true;
  const journal = new TerminalJournal();
  const originalWrite = terminal.write;
  terminal.write = (data, callback) => originalWrite.call(terminal, data, () => {
    journal.data(typeof data === 'string' ? data : new TextDecoder().decode(data));
    callback?.();
  });
  const resized = terminal.onResize(size => journal.resize(size.cols, size.rows));
  let owner: string | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const retired = new Set<string>();
  const retire = () => {
    const hadOwner = !!owner;
    clearTimeout(expiry);
    if (owner) retired.add(owner);
    while (retired.size > 64) retired.delete(retired.values().next().value!);
    owner = undefined;
    if (hadOwner) terminal.write('', () => { if (alive && !owner) sizing?.releaseRemoteSize(); });
  };
  const snapshot = async (options?: TerminalReadOptions): Promise<TerminalSnapshot> => {
    if (options?.viewport && sizing) {
      const viewport = options.viewport;
      if (!retired.has(viewport.controlId)) {
        if (owner && owner !== viewport.controlId) retired.add(owner);
        while (retired.size > 64) retired.delete(retired.values().next().value!);
        owner = viewport.controlId;
        clearTimeout(expiry);
        // Expiry releases ownership; it does not permanently reject a viewer
        // after a transient network delay. Explicit local input retires it.
        expiry = setTimeout(() => {
          owner = undefined;
          terminal.write('', () => { if (alive && !owner) sizing.releaseRemoteSize(); });
        }, 5000);
        // Parse old-size output before changing the grid, in both renderers.
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Terminal renderer did not finish updating.')), 4000);
          terminal.write('', () => { clearTimeout(timeout); resolve(); });
        });
        if (!alive) return readSharedTerminal(id, options);
        if (owner !== viewport.controlId) return snapshot({ ...options, viewport: undefined });
        await sizing.setRemoteSize(viewport);
      }
    }
    if (options?.stream && options.cursor) await journal.wait(options.cursor);
    // Drain queued writes before serializing, including split escape sequences.
    return new Promise<TerminalSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Terminal renderer did not finish updating.')), 4000);
      terminal.write('', () => {
        clearTimeout(timer);
        if (!alive) { void readSharedTerminal(id, options).then(resolve, reject); return; }
        try {
          const base = { cols: terminal.cols, rows: terminal.rows, windowsPty: terminal.options.windowsPty,
            ...(options?.stream ? { streamId: journal.streamId, sequence: journal.sequence,
              controlling: !!options.viewport && owner === options.viewport.controlId } : {}) };
          const events = options?.stream ? journal.read(options.cursor) : null;
          if (events) { resolve({ kind: 'terminalDelta', ...base, data: '', events }); return; }
          if (terminal.modes.synchronizedOutputMode) throw new Error('Terminal is updating; waiting for a complete frame.');
          // SerializeAddon cannot checkpoint the middle of an unfinished CSI,
          // OSC or DCS sequence. xterm 6 is pinned; delta writes preserve that
          // parser state, but the first checkpoint must wait for ground state.
          const parser = (terminal as unknown as { _core?: { _inputHandler?: { _parser?: { currentState: number } } } })._core?._inputHandler?._parser;
          if (parser && parser.currentState !== 0) throw new Error('Terminal is completing an output sequence.');
          let scrollback = 2000;
          for (;;) {
            const result: TerminalSnapshot = { kind: 'terminal', ...base, data: serializer.serialize({ scrollback }) };
            if (new TextEncoder().encode(JSON.stringify(result)).length <= MAX_SNAPSHOT_BYTES) { resolve(result); return; }
            if (!scrollback) throw new Error('The terminal screen is too large to share.');
            scrollback = Math.floor(scrollback / 2);
          }
        } catch (error) { reject(error); }
      });
    });
  };
  sources.set(id, snapshot);
  const preview = () => {
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    // Save precisely the visible screen, including TUIs in the alternate buffer.
    for (let row = buffer.viewportY; row < Math.min(buffer.length, buffer.viewportY + terminal.rows); row++)
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
    return { text: lines.join('\n').slice(-60_000), terminal: true,
      fontSize: terminal.options.fontSize ?? 14, fontFamily: terminal.options.fontFamily ?? 'monospace' };
  };
  previews.set(id, preview);
  const dispose = () => {
    alive = false;
    clearTimeout(expiry); resized.dispose(); journal.dispose();
    terminal.write = originalWrite;
    if (sources.get(id) === snapshot) sources.delete(id);
    if (previews.get(id) === preview) previews.delete(id);
  };
  return Object.assign(dispose, { reclaimLocal: retire });
}

export async function readSharedTerminal(id: string, options?: TerminalReadOptions): Promise<TerminalSnapshot> {
  const source = sources.get(id);
  if (!source) throw new Error('Terminal has not started. Open this panel on the host computer first.');
  return source(options);
}

export async function initTerminalSharing() {
  return listen<{ requestId: string; panelId: string; options?: TerminalReadOptions }>('lan-terminal-read', async ({ payload }) => {
    let snapshot: TerminalSnapshot | null = null;
    let error: string | null = null;
    try { snapshot = await readSharedTerminal(payload.panelId, payload.options); }
    catch (err) { error = String(err); }
    await invoke('lan_terminal_snapshot_result', { requestId: payload.requestId, snapshot, error })
      .catch(err => console.error('[LAN] terminal snapshot response failed:', err));
  });
}
