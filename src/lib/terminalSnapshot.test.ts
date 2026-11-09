import { afterEach, describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { SerializeAddon } from '@xterm/addon-serialize';
import { withTerminalState } from './terminalSnapshot';

const write = (term: Terminal, data: string) => new Promise<void>(resolve => term.write(data, resolve));
type Fixture = { term: Terminal; serializer: SerializeAddon; snapshotter: ReturnType<typeof withTerminalState> };
const fixtures: Fixture[] = [];
function fixture(): Fixture {
  const term = new Terminal({ cols: 8, rows: 4, allowProposedApi: true });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  const snapshotter = withTerminalState(term, serializer);
  const result = { term, serializer, snapshotter };
  fixtures.push(result);
  return result;
}
afterEach(() => { for (const f of fixtures.splice(0)) { f.snapshotter.dispose(); f.term.dispose(); } });
const cursor = (term: Terminal) => [term.buffer.active.cursorX, term.buffer.active.cursorY];
const line = (term: Terminal, row = 0) => term.buffer.active.getLine(term.buffer.active.baseY + row)?.translateToString(true).trimEnd();

describe('terminal cursor checkpoints', () => {
  it('does not strand the first typed character after restoring a full-width footer', async () => {
    const before = fixture();
    await write(before.term, '> \x1b[4;1H12345678\x1b[1;3H');
    expect(cursor(before.term)).toEqual([2, 0]);
    const lossy = fixture();
    await write(lossy.term, before.serializer.serialize());
    expect(cursor(lossy.term)).toEqual([1, 0]); // Original SerializeAddon regression.
    const restored = fixture();
    await write(restored.term, before.snapshotter.serialize());
    expect(cursor(restored.term)).toEqual([2, 0]);
    // Actual agy/ConPTY sequence: type, place the cursor, then erase the key.
    const inputThenBackspace = 'a\x1b[1;4H\x08 \x1b[1;3H';
    await write(lossy.term, inputThenBackspace);
    await write(restored.term, inputThenBackspace);
    expect(line(lossy.term)).toBe('>a');
    expect(line(restored.term)).toBe('>');
    const again = fixture();
    await write(again.term, restored.snapshotter.serialize());
    expect(cursor(again.term)).toEqual([2, 0]);
    expect(cursor(before.term)).toEqual([2, 0]); // Serializing never changes the source.
  });

  it('keeps alternate-screen cursor, colors and mouse/paste modes across a remount', async () => {
    const before = fixture();
    await write(before.term, 'history\x1b[?1049h\x1b[?1003;1006;2004h\x1b[31m> \x1b[4;1H12345678\x1b[1;3H');
    const restored = fixture();
    await write(restored.term, before.snapshotter.serialize());
    expect(restored.term.buffer.active.type).toBe('alternate');
    expect(cursor(restored.term)).toEqual([2, 0]);
    expect(restored.term.modes.mouseTrackingMode).toBe('any');
    expect(restored.term.modes.bracketedPasteMode).toBe(true);
    expect(restored.snapshotter.serialize()).toContain('\x1b[?1006h');
    await write(restored.term, 'x');
    expect(restored.term.buffer.active.getLine(0)?.getCell(2)?.getFgColor()).toBe(1);
  });

  it('keeps cursor positioning in scrollback-limited snapshots used by LAN panels', async () => {
    const before = fixture();
    await write(before.term, 'history\r\n'.repeat(12) + '> \x1b[4;1H12345678\x1b[3;3H');
    const restored = fixture();
    await write(restored.term, before.snapshotter.serialize({ scrollback: 2 }));
    expect(cursor(restored.term)).toEqual(cursor(before.term));
    expect(restored.term.buffer.active.baseY).toBe(2);
  });

  it('does not cancel pending wrap or alter range exports and origin-mode snapshots', async () => {
    const before = fixture();
    await write(before.term, '12345678');
    expect(before.term.buffer.active.cursorX).toBe(8);
    const restored = fixture();
    await write(restored.term, before.snapshotter.serialize());
    await write(restored.term, 'x');
    expect(line(restored.term)).toBe('12345678');
    expect(line(restored.term, 1)).toBe('x');
    const options = { range: { start: 0, end: 0 } };
    expect(before.snapshotter.serialize(options)).toBe(before.serializer.serialize(options));
    await write(before.term, '\x1b[2;4r\x1b[?6h\x1b[2;3H');
    expect(before.snapshotter.serialize()).toBe(before.serializer.serialize());
  });
});
