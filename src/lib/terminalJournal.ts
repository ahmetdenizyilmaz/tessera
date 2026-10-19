/** Bounded, ordered VT output. A new reader gets one checkpoint, then only
 * output/resize events. Lost cursors resynchronize instead of replaying a tail
 * that could start in the middle of an escape sequence. */
export interface TerminalCursor { streamId: string; sequence: number }
export type TerminalEvent =
  | { type: 'data'; sequence: number; data: string }
  | { type: 'resize'; sequence: number; cols: number; rows: number };
export class TerminalJournal {
  readonly streamId = crypto.randomUUID();
  sequence = 0;
  private entries: { event: TerminalEvent; bytes: number }[] = [];
  private bytes = 0;
  private listeners = new Set<() => void>();
  constructor(private budget = 512 * 1024) {}
  private append(event: TerminalEvent) {
    const bytes = new TextEncoder().encode(JSON.stringify(event)).length;
    this.entries.push({ event, bytes }); this.bytes += bytes;
    while (this.bytes > this.budget && this.entries.length) this.bytes -= this.entries.shift()!.bytes;
    for (const listener of this.listeners) listener();
  }
  data(data: string) { if (data) this.append({ type: 'data', sequence: ++this.sequence, data }); }
  resize(cols: number, rows: number) { this.append({ type: 'resize', sequence: ++this.sequence, cols, rows }); }
  read(cursor?: TerminalCursor): TerminalEvent[] | null {
    if (!cursor || cursor.streamId !== this.streamId || !Number.isSafeInteger(cursor.sequence)
      || cursor.sequence > this.sequence || cursor.sequence < 0
      || cursor.sequence < (this.entries[0]?.event.sequence ?? this.sequence + 1) - 1) return null;
    return this.entries.filter(e => e.event.sequence > cursor.sequence).map(e => e.event);
  }
  wait(cursor: TerminalCursor, timeout = 900): Promise<void> {
    if (this.read(cursor)?.length !== 0) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.listeners.delete(done); resolve(); };
      const timer = setTimeout(done, timeout);
      this.listeners.add(done);
    });
  }
  dispose() { for (const listener of this.listeners) listener(); this.listeners.clear(); }
}
