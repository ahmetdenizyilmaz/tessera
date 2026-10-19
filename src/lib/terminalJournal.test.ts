import { describe, expect, it } from 'vitest';
import { TerminalJournal } from './terminalJournal';

describe('shared terminal output journal', () => {
  it('sends only the ordered bytes and resizes since an acknowledged cursor', () => {
    const log = new TerminalJournal();
    const cursor = { streamId: log.streamId, sequence: 0 };
    log.data('\x1b[3'); log.data('1mÜnye 漢字'); log.resize(120, 40); log.data('after resize');
    expect(log.read(cursor)).toEqual([
      { type: 'data', sequence: 1, data: '\x1b[3' }, { type: 'data', sequence: 2, data: '1mÜnye 漢字' },
      { type: 'resize', sequence: 3, cols: 120, rows: 40 }, { type: 'data', sequence: 4, data: 'after resize' },
    ]);
    expect(log.read({ ...cursor, sequence: 2 })).toHaveLength(2);
    expect(log.read({ ...cursor, sequence: 4 })).toEqual([]);
    expect(log.read({ ...cursor, sequence: 5 })).toBeNull();
    expect(log.read({ ...cursor, streamId: 'a previous process' })).toBeNull();
  });
  it('requires a checkpoint after buffer overflow, never returning a partial tail', () => {
    const log = new TerminalJournal(180);
    log.data('a'.repeat(80)); const saved = { streamId: log.streamId, sequence: log.sequence };
    log.data('b'.repeat(80)); log.data('c'.repeat(80));
    expect(log.read(saved)).toBeNull();
    expect(log.read({ ...saved, sequence: log.sequence - 1 })).toHaveLength(1);
    log.data('z'.repeat(300));
    expect(log.read({ ...saved, sequence: log.sequence - 1 })).toBeNull();
    expect(log.read({ ...saved, sequence: log.sequence })).toEqual([]);
  });
  it('wakes a pending read on output or disposal and returns nothing while idle', async () => {
    const log = new TerminalJournal(); const cursor = { streamId: log.streamId, sequence: 0 };
    const changed = log.wait(cursor); log.data('hello'); await changed;
    expect(log.read(cursor)?.[0]).toMatchObject({ data: 'hello' });
    const idle = { ...cursor, sequence: 1 };
    await log.wait(idle, 5); expect(log.read(idle)).toEqual([]);
    const closing = log.wait(idle); log.dispose(); await closing;
  });
});
