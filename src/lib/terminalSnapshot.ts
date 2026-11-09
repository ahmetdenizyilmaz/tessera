import type { Terminal } from '@xterm/xterm';
import type { SerializeAddon } from '@xterm/addon-serialize';
import { withMouseEncoding } from './terminalMouseEncoding';

/** Preserve the live terminal state across moves, hidden panels and LAN snapshots. */
export function withTerminalState(terminal: Terminal, serializer: SerializeAddon) {
  const mouse = withMouseEncoding(terminal, serializer);
  return {
    serialize(options?: Parameters<SerializeAddon['serialize']>[0]) {
      const data = mouse.serialize(options);
      const buffer = options?.excludeAltBuffer ? terminal.buffer.normal : terminal.buffer.active;
      // SerializeAddon 0.14 restores the cursor with relative moves from the
      // last printed cell. A full-width footer leaves wrap pending (x = cols);
      // moving up clamps it to cols - 1, so the following left move ends one
      // column short. agy then paints the first key before its actual input,
      // and Backspace erases the next cell, leaving the key visibly stuck.
      // A final absolute move fixes the checkpoint without touching PTY input,
      // attributes or the source parser. Range exports have no final cursor;
      // pending wrap and origin-relative positioning must keep their semantics.
      if (options?.range || terminal.modes.originMode || buffer.cursorX >= terminal.cols) return data;
      return data + `\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`;
    },
    dispose: () => mouse.dispose(),
  };
}
