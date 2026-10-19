import type { Terminal } from '@xterm/xterm';
import type { TerminalSnapshot } from './terminalSharing';
import type { TerminalCursor } from './terminalJournal';

const geometry = (cols: number, rows: number) => Number.isInteger(cols) && Number.isInteger(rows)
  && cols >= 2 && rows >= 1 && cols <= 4096 && rows <= 4096;

/** Applies ordered VT bytes without resetting the local parser on each read.
 * In particular a chunk can end halfway through a Unicode/escape sequence. */
export class RemoteTerminalStream {
  cursor?: TerminalCursor;
  constructor(private terminal: Terminal) {}
  async apply(frame: TerminalSnapshot) {
    if (!frame || !geometry(frame.cols, frame.rows) || typeof frame.data !== 'string') {
      throw new Error('The host sent an invalid terminal screen.');
    }
    const term = this.terminal;
    const write = (data: string) => new Promise<void>(resolve => term.write(data, resolve));
    const following = term.buffer.active.viewportY >= term.buffer.active.baseY;
    const offset = term.buffer.active.baseY - term.buffer.active.viewportY;
    if (frame.kind === 'terminal') {
      term.options.windowsPty = frame.windowsPty;
      term.resize(frame.cols, frame.rows);
      await write(`\x1bc${frame.data}`);
    } else if (frame.kind === 'terminalDelta') {
      let sequence = this.cursor?.sequence;
      if (!this.cursor || frame.streamId !== this.cursor.streamId || !Number.isSafeInteger(frame.sequence)) {
        this.cursor = undefined;
        throw new Error('Resynchronizing terminal output…');
      }
      for (const event of frame.events ?? []) {
        if (event.sequence !== sequence! + 1 || (event.type === 'resize' && !geometry(event.cols, event.rows))
          || (event.type === 'data' && typeof event.data !== 'string') || !['data', 'resize'].includes(event.type)) {
          this.cursor = undefined;
          throw new Error('Resynchronizing terminal output…');
        }
        sequence = event.sequence;
      }
      if (sequence !== frame.sequence) { this.cursor = undefined; throw new Error('Resynchronizing terminal output…'); }
      for (const event of frame.events ?? []) {
        if (event.type === 'data') await write(event.data);
        else term.resize(event.cols, event.rows);
      }
    } else { throw new Error('Update Tessera on the host computer to share terminal screens.'); }
    this.cursor = frame.streamId && Number.isSafeInteger(frame.sequence)
      ? { streamId: frame.streamId, sequence: frame.sequence! } : undefined;
    if (following) term.scrollToBottom();
    else term.scrollToLine(Math.max(0, term.buffer.active.baseY - offset));
  }
}
