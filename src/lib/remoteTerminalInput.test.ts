import { describe, expect, it, vi } from 'vitest';
import { RemoteTerminalInput } from './remoteTerminalInput';

const target = { deviceId: 'pc', panelId: 'terminal', connectionId: 'connection', inputSession: 'pty' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('remote terminal input', () => {
  it('sends exact ordered keys/paste without message wrappers or added Enter', async () => {
    let release!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
    const input = new RemoteTerminalInput(send, vi.fn());
    input.setTarget(target);
    input.enqueue('a'); input.enqueue('\x1b[A'); input.enqueue('\x1b[200~Ünye\n  漢字\x1b[201~'); input.enqueue('\r');
    expect(send).toHaveBeenCalledTimes(1);
    release(); await tick();
    expect(send.mock.calls.map(call => call[1])).toEqual(['a', '\x1b[A', '\x1b[200~Ünye\n  漢字\x1b[201~', '\r']);
    expect(send.mock.calls.every(call => call[0] === target)).toBe(true);
  });

  it.each(['disconnect', 'restart', 'unmount'])('discards queued input on %s, including late acknowledgements', async action => {
    let release!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
    const delivered = vi.fn();
    const input = new RemoteTerminalInput(send, vi.fn(), delivered);
    input.setTarget(target); input.enqueue('first'); input.enqueue('stale'); input.enqueue('\r');
    if (action === 'unmount') input.dispose();
    else input.setTarget(action === 'disconnect' ? null : { ...target, inputSession: 'replacement' });
    release(); await tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(delivered).not.toHaveBeenCalled();
    if (action !== 'unmount') {
      input.setTarget({ ...target, connectionId: 'new' }); input.enqueue('fresh'); await tick();
      expect(send.mock.calls.map(call => call[1])).toEqual(['first', 'fresh']);
    }
  });

  it('stops on ambiguous failure without retrying or sending queued Enter', async () => {
    const send = vi.fn().mockRejectedValue(new Error('timeout'));
    const error = vi.fn();
    const input = new RemoteTerminalInput(send, error);
    input.setTarget(target); input.enqueue('text'); input.enqueue('\r'); await tick();
    input.setTarget({ ...target }); input.enqueue('more'); await tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(input.ready).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unsent keys were discarded'));
  });

  it('rejects oversized Unicode paste as a whole and never sends without a live target', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const error = vi.fn();
    const input = new RemoteTerminalInput(send, error);
    input.enqueue('offline');
    input.setTarget(target); input.enqueue('漢'.repeat(23000)); await tick();
    expect(send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    input.dispose(); input.setTarget(target); input.enqueue('closed');
    expect(send).not.toHaveBeenCalled();
  });
});
