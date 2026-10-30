import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { SerializeAddon } from '@xterm/addon-serialize';
import { withMouseEncoding } from './terminalMouseEncoding';

const write = (terminal: Terminal, data: string) => new Promise<void>(resolve => terminal.write(data, resolve));

function terminal() {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  return { term, snapshotter: withMouseEncoding(term, serializer) };
}

/** What xterm emits for one wheel-up notch at column 10, row 5. X10 reports
 * go to onBinary, which the panel never forwards to the PTY. */
function wheelUp(term: Terminal) {
  const sent: string[] = [];
  const listeners = [term.onData(data => sent.push(data)), term.onBinary(data => sent.push(`binary:${data}`))];
  (term as unknown as { _core: { coreMouseService: { triggerMouseEvent(e: object): boolean } } })._core.coreMouseService
    .triggerMouseEvent({ col: 9, row: 4, x: 0, y: 0, button: 4, action: 0, ctrl: false, alt: false, shift: false });
  listeners.forEach(listener => listener.dispose());
  return sent.join('');
}

describe('terminal snapshots keep the mouse report encoding', () => {
  it('restores SGR wheel reports after a remount, as Codex requested them', async () => {
    const before = terminal();
    await write(before.term, '\x1b[?1049h\x1b[?1003;1006hhistory');
    expect(wheelUp(before.term)).toBe('\x1b[<64;10;5M');
    const plain = new SerializeAddon();
    before.term.loadAddon(plain);
    // Without the fix the restored view switches to legacy X10 reports.
    const lossy = terminal();
    await write(lossy.term, plain.serialize());
    expect(wheelUp(lossy.term)).toBe('binary:\x1b[M`*%');
    const restored = terminal();
    await write(restored.term, before.snapshotter.serialize());
    expect(wheelUp(restored.term)).toBe('\x1b[<64;10;5M');
    // The restored view keeps tracking it for the next remount.
    expect(restored.snapshotter.serialize()).toMatch(/\x1b\[\?1006h$/);
    [before, lossy, restored].forEach(({ term }) => term.dispose());
  });

  it('follows resets like xterm and honours excludeModes', async () => {
    const { term, snapshotter } = terminal();
    await write(term, '\x1b[?1000h\x1b[?1016h');
    expect(snapshotter.serialize()).toMatch(/\x1b\[\?1016h$/);
    expect(snapshotter.serialize({ excludeModes: true })).not.toContain('\x1b[?1016h');
    await write(term, '\x1b[?1006l');
    expect(snapshotter.serialize()).not.toMatch(/\x1b\[\?10(06|16)h/);
    await write(term, '\x1b[?1006h\x1bc');
    expect(snapshotter.serialize()).not.toContain('\x1b[?1006h');
    snapshotter.dispose();
    await write(term, '\x1b[?1006h');
    expect(snapshotter.serialize()).not.toContain('\x1b[?1006h');
    term.dispose();
  });
});
