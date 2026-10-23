import { beforeEach, describe, expect, it } from 'vitest';
import { canAutoHibernate, elapsedAppTime, normalizeHibernation } from './panelHibernationPolicy';
import { forgetPanelActivity, hasTerminalDraft, isPanelViewed, noteTerminalInput, panelActivityRevision, setPanelViewed } from './panelActivityClock';

const idle = { enabledMinutes: 60, idleMs: 3600_000, focused: false, busy: false,
  knownIdle: true, hasDraft: false, starting: false, sleeping: false };
describe('safe idle policy', () => {
  it('sleeps only after the configured running-time threshold', () => {
    expect(canAutoHibernate(idle)).toBe(true);
    expect(canAutoHibernate({ ...idle, idleMs: 3599_999 })).toBe(false);
    expect(canAutoHibernate({ ...idle, enabledMinutes: 0 })).toBe(false);
    expect(canAutoHibernate({ ...idle, enabledMinutes: NaN })).toBe(false);
  });
  it.each(['focused', 'busy', 'hasDraft', 'starting', 'sleeping'] as const)('protects %s panels', flag => {
    expect(canAutoHibernate({ ...idle, [flag]: true })).toBe(false);
  });
  it('never interprets missing provider activity as idle', () => {
    expect(canAutoHibernate({ ...idle, knownIdle: false })).toBe(false);
  });
  it('counts normal app ticks and ignores computer suspend / timer suspension', () => {
    expect(elapsedAppTime(1000, 16000)).toBe(15000);
    expect(elapsedAppTime(1000, 86401_000)).toBe(0);
    expect(elapsedAppTime(1000, 50)).toBe(0);
    // Restart the clock at zero: the saved duration has no date to age offline.
    const restored = normalizeHibernation({ idleMs: 28 * 60_000 });
    expect(restored.idleMs + elapsedAppTime(0, 15000)).toBe(28 * 60_000 + 15000);
  });
  it('normalizes legacy / corrupt workspace fields', () => {
    expect(normalizeHibernation()).toEqual({ idleMs: 0, sleeping: false, previewId: undefined });
    expect(normalizeHibernation({ idleMs: -100, previewId: '../secret' }).idleMs).toBe(0);
    expect(normalizeHibernation({ idleMs: Infinity }).idleMs).toBe(0);
    expect(normalizeHibernation({ sleeping: true }).sleeping).toBe(true);
  });
});

describe('input and focus tracking', () => {
  beforeEach(() => forgetPanelActivity('p'));
  it('keeps unsent terminal text and multiline paste awake until submitted', () => {
    noteTerminalInput('p', 'draft'); expect(hasTerminalDraft('p')).toBe(true);
    noteTerminalInput('p', '\r'); expect(hasTerminalDraft('p')).toBe(false);
    noteTerminalInput('p', '\x1b[200~first\nsecond\x1b[201~'); expect(hasTerminalDraft('p')).toBe(true);
    noteTerminalInput('p', '\x03'); expect(hasTerminalDraft('p')).toBe(false);
    noteTerminalInput('p', '\x1b[A'); expect(hasTerminalDraft('p')).toBe(true);
  });
  it('does not mistake terminal query replies or focus reports for user input', () => {
    for (const data of ['\x1b[12;5R', '\x1b[?1;2c', '\x1b]10;rgb:ffff/ffff/ffff\x07', '\x1b[I', '\x1b[O']) noteTerminalInput('p', data);
    expect(hasTerminalDraft('p')).toBe(false);
    expect(panelActivityRevision('p')).toBe(0);
  });
  it('keeps office focus protection when its terminal view unmounts', () => {
    setPanelViewed('p', true); setPanelViewed('p', true, 'office');
    setPanelViewed('p', false); expect(isPanelViewed('p')).toBe(true);
    setPanelViewed('p', false, 'office'); expect(isPanelViewed('p')).toBe(false);
  });
});
