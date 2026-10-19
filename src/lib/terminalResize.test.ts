import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { createTerminalResize } from './terminalResize';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  let dimensions = { cols: 100, rows: 40 }, active = true;
  const parsed: (() => void)[] = [];
  const view = { requestAnimationFrame: (fn: () => void) => setTimeout(fn, 16), cancelAnimationFrame: clearTimeout, setTimeout, clearTimeout };
  const terminal = { cols: 100, rows: 40, refresh: vi.fn(), write: (_: string, fn: () => void) => parsed.push(fn),
    resize: vi.fn((cols: number, rows: number) => { Object.assign(terminal, { cols, rows }); }),
    element: { ownerDocument: { defaultView: view }, parentElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) } } };
  const fit = { proposeDimensions: () => dimensions, fit: vi.fn(() => { Object.assign(terminal, dimensions); }) };
  const resize = vi.fn(async () => {});
  const coordinator = createTerminalResize(terminal as unknown as Terminal, fit as unknown as FitAddon, resize, () => active);
  return { terminal, fit, resize, coordinator, parsed, setSize: (cols: number, rows: number) => { dimensions = { cols, rows }; }, setActive: (value: boolean) => { active = value; } };
}
it('waits for saved output restoration before applying a new size', async () => {
  const t = fixture();
  t.coordinator.pauseForRestore(); t.setSize(65, 24);
  t.coordinator.ready({ cols: 100, rows: 40 });
  t.coordinator.fitNow();
  expect(t.fit.fit).not.toHaveBeenCalled(); expect(t.resize).not.toHaveBeenCalled();
  t.coordinator.finishRestore(); t.coordinator.fitNow();
  await vi.runAllTimersAsync();
  expect(t.resize).toHaveBeenCalledExactlyOnceWith(65, 24);
  expect(t.terminal.refresh).toHaveBeenCalledWith(0, 23);
});
it('coalesces drag sizes and drains queued screen output before fitting', async () => {
  const t = fixture();
  t.coordinator.ready({ cols: 100, rows: 40 });
  for (const cols of [80, 60, 120]) {
    t.setSize(cols, 30); t.coordinator.requestFit(); await vi.advanceTimersByTimeAsync(30);
  }
  expect(t.resize).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(100);
  expect(t.resize).not.toHaveBeenCalled();
  expect(t.parsed).toHaveLength(1);
  t.parsed.shift()!(); await vi.runAllTimersAsync();
  expect(t.resize).toHaveBeenCalledExactlyOnceWith(120, 30);
});
it('repaints an unchanged grid without resizing ConPTY or altering history', async () => {
  const t = fixture();
  t.coordinator.ready({ cols: 100, rows: 40 }); t.coordinator.fitNow();
  await vi.runAllTimersAsync();
  expect(t.resize).not.toHaveBeenCalled();
  expect(t.fit.fit).not.toHaveBeenCalled();
  expect(t.terminal.refresh).toHaveBeenCalledWith(0, 39);
});
it('does not resize inactive previews or run a queued callback after disposal', async () => {
  const t = fixture();
  t.coordinator.ready({ cols: 100, rows: 40 }); t.setActive(false); t.setSize(30, 10);
  t.coordinator.fitNow(); expect(t.fit.fit).not.toHaveBeenCalled();
  t.setActive(true); t.coordinator.requestFit(); await vi.runAllTimersAsync();
  t.coordinator.dispose(); t.parsed.shift()!();
  expect(t.resize).not.toHaveBeenCalled();
});
it('fits a remote controller while the host is inactive, then yields to local control', async () => {
  const t = fixture(); t.coordinator.ready({ cols: 100, rows: 40 });
  t.setActive(false); t.setSize(18, 2);
  await t.coordinator.setRemoteSize({ cols: 120, rows: 45, inputSession: 'current-pty' });
  t.coordinator.fitNow();
  expect(t.terminal.cols).toBe(120);
  expect(t.resize).toHaveBeenCalledExactlyOnceWith(120, 45, 'current-pty');
  t.setActive(true); t.setSize(110, 32); t.coordinator.releaseRemoteSize();
  await vi.runAllTimersAsync();
  expect(t.resize).toHaveBeenLastCalledWith(110, 32);
});
it('gives newly spawned tiny previews a usable initial terminal size', () => {
  const t = fixture(); t.setActive(false); t.setSize(18, 2); t.coordinator.fitNow();
  expect(t.terminal.cols).toBe(80); expect(t.terminal.rows).toBe(24);
  expect(t.resize).not.toHaveBeenCalled();
});
it('reports remote resize failure without claiming it was delivered', async () => {
  const t = fixture(); t.coordinator.ready({ cols: 100, rows: 40 });
  t.resize.mockRejectedValueOnce(new Error('session changed'));
  await expect(t.coordinator.setRemoteSize({ cols: 120, rows: 45, inputSession: 'old-pty' })).rejects.toThrow('session changed');
  await t.coordinator.setRemoteSize({ cols: 120, rows: 45, inputSession: 'new-pty' });
  expect(t.resize).toHaveBeenLastCalledWith(120, 45, 'new-pty');
});
