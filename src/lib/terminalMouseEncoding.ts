import type { Terminal } from '@xterm/xterm';
import type { SerializeAddon } from '@xterm/addon-serialize';

/** SerializeAddon restores mouse tracking (?1000/1002/1003h) but not the
 * report encoding. Codex asks for SGR reports (?1006h); after a remount xterm
 * falls back to X10 reports, which ConPTY delivers to Codex as typed text, so
 * the wheel stops scrolling its history. Mirror xterm's encoding state from
 * the parser and append it to every snapshot. */
export function withMouseEncoding(terminal: Terminal, serializer: SerializeAddon) {
  let encoding: 1006 | 1016 | undefined;
  const set = (enable: boolean) => (params: (number | number[])[]) => {
    for (const param of params) {
      // Like xterm: either reset returns to the default encoding.
      if (param === 1006 || param === 1016) encoding = enable ? param : undefined;
    }
    return false; // Observe only; xterm still applies the mode.
  };
  const handlers = [
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, set(true)),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, set(false)),
    terminal.parser.registerEscHandler({ final: 'c' }, () => { encoding = undefined; return false; }),
  ];
  return {
    serialize: (options?: Parameters<SerializeAddon['serialize']>[0]) =>
      serializer.serialize(options) + (encoding && !options?.excludeModes ? `\x1b[?${encoding}h` : ''),
    dispose: () => handlers.forEach(handler => handler.dispose()),
  };
}
