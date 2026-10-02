import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('window', { localStorage: globalThis.localStorage });
  return values;
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../components/terminal/XTermView', () => ({ clearTerminalState: vi.fn() }));
vi.mock('../hooks/usePty', () => ({ cleanupPty: vi.fn() }));
vi.mock('./toast', () => ({ notify: vi.fn() }));
const { useOfficeGameStore: office } = await import('../store/officeGameStore');
const { ingestOfficeRecords } = await import('../hooks/useWorkerActivity');
const { takeTerminalForkPrompt } = await import('./antigravitySessions');
import { useInstanceStore } from '../store/instanceStore';
import { antigravitySignal, rewardForTools } from './officeActivity';
import { antigravityOfficeTool, antigravityStatus, antigravityTranscript, formatAntigravityUsage, ANTIGRAVITY_PERMISSIONS } from './antigravityConfig';
import { activitySummary, providerName } from './activityGraph';
import type { AntigravityItem, AntigravitySnapshot } from '../types/antigravity';
import type { ActivityRecord } from '../types/activity';

const session = (extra: Partial<AntigravitySnapshot> = {}): AntigravitySnapshot => ({ generation: 'g', configured: true, conversationId: 'conv', processAlive: true, busy: false, items: [], ...extra });
const user: AntigravityItem = { id: 'u-1', type: 'user', text: 'Run the build and fix what fails', at: 1 };
const usage = { input: 12529, output: 699, thinking: 330, cacheRead: 0, total: 13228 };
const turn = (id: string, extra: Partial<ActivityRecord> = {}): ActivityRecord => ({ id, kind: 'turn', actor: { id: 'panel-g', name: 'Gemini build', provider: 'antigravity', model: 'gemini-3.8-flash-low', device: null },
  target: null, sessionId: 'conv', startedAt: 100, updatedAt: 200, status: 'completed', prompt: 'Run the build', response: 'Done', usage: { input: 12529, output: 699, cacheRead: 0, cacheWrite: 0, reasoning: 330 },
  parentId: null, usageNote: null, origin: 'user', tools: ['Bash', 'Write'], ...extra });
void storage;

beforeEach(() => {
  office.setState({ workers: {}, profiles: {}, panelAliases: {}, currency: 150, totalEarned: 0, completedTasks: 0, rewards: [], claimed: {}, startedAt: 50 });
  useInstanceStore.setState({ instances: new Map() });
});

describe('Antigravity office state', () => {
  it('is working for the whole open turn, however quiet the output is', () => {
    // Nothing printed since the question: still thinking, never idle.
    expect(antigravitySignal(session({ busy: true, items: [user] }))).toEqual({ activity: 'thinking', task: 'Run the build and fix what fails', detail: '' });
    // A finished tool with no further output is still an open turn.
    expect(antigravitySignal(session({ busy: true, items: [user, { id: 't1', type: 'tool', name: 'run_command', state: 'done', at: 2 }] })).activity).toBe('thinking');
    expect(antigravitySignal(session({ busy: true, items: [user, { id: 't1', type: 'tool', name: 'run_command', state: 'active', at: 2 }] }))).toMatchObject({ activity: 'running_command', detail: 'run_command' });
    expect(antigravitySignal(session({ busy: true, items: [user, { id: 't2', type: 'tool', name: 'view_file', state: 'active', at: 2 }] })).activity).toBe('reading_file');
    expect(antigravitySignal(session({ busy: true, items: [user, { id: 't3', type: 'tool', name: 'multi_replace_file_content', state: 'active', at: 2 }] })).activity).toBe('editing_file');
    expect(antigravitySignal(session({ busy: true, items: [user, { id: 't4', type: 'tool', name: 'search_web', state: 'active', at: 2 }] })).activity).toBe('searching_web');
    expect(antigravitySignal(session({ busy: true, items: [user, { id: 'a1', type: 'assistant', text: 'Working', state: 'active', at: 3 }] })).activity).toBe('responding');
    // The previous turn's tool must not leak into a new question.
    expect(antigravitySignal(session({ busy: true, items: [user, { id: 't1', type: 'tool', name: 'run_command', state: 'active', at: 2 }, { id: 'r', type: 'result', level: 'completed', text: 'SUCCESS', at: 3 }, { ...user, id: 'u-2', text: 'Next' }] }))).toMatchObject({ activity: 'thinking', task: 'Next' });
  });
  it('is idle, waiting, or in error only when agy said the turn ended that way', () => {
    const done = (level: string, text: string): AntigravityItem => ({ id: 'r', type: 'result', level, text, at: 9 });
    expect(antigravitySignal(session({ items: [user, done('completed', 'SUCCESS')] })).activity).toBe('idle');
    expect(antigravitySignal(session({ items: [user, done('completed', 'WAITING')] }))).toMatchObject({ activity: 'awaiting_permission', detail: 'Waiting for your reply' });
    expect(antigravitySignal(session({ items: [user, done('failed', 'ERROR')] })).activity).toBe('error');
    expect(antigravitySignal(session({ items: [user, done('interrupted', 'STOPPED')] })).activity).toBe('idle');
    expect(antigravitySignal(session({ error: 'You are not logged into Antigravity.', recovery: 'login', items: [user] }))).toMatchObject({ activity: 'error', detail: 'You are not logged into Antigravity.' });
    expect(antigravitySignal(session({ configured: false, error: 'agy was not found' })).activity).toBe('error');
    expect(antigravitySignal(session({ configured: false })).activity).toBe('unknown');
    expect(antigravitySignal(undefined).activity).toBe('unknown');
    expect(antigravitySignal(session()).activity).toBe('idle');
  });
  it('awards a completed turn exactly once, and nothing for stopped, failed or still-running turns', () => {
    ingestOfficeRecords([turn('antigravity:conv:t1'), turn('antigravity:conv:t1'), turn('antigravity:conv:t2', { status: 'interrupted' }), turn('antigravity:conv:t3', { status: 'failed' }), turn('antigravity:conv:t4', { status: 'running' })]);
    const coins = rewardForTools(['Bash', 'Write']);
    expect(office.getState().currency).toBe(150 + coins);
    // Polling, reopening the office and a resumed conversation replay the same record.
    ingestOfficeRecords([turn('antigravity:conv:t1', { updatedAt: 999 })]);
    expect(office.getState().currency).toBe(150 + coins);
    expect(office.getState().profiles['panel-g']).toMatchObject({ tasks: 1, coins });
    ingestOfficeRecords([turn('antigravity:conv:t4')]);
    expect(office.getState().profiles['panel-g'].tasks).toBe(2);
  });
});

describe('Antigravity presentation', () => {
  it('maps agy tools to the shared vocabulary and formats reported usage', () => {
    expect(['run_command', 'write_to_file', 'replace_file_content', 'view_file', 'list_dir', 'search_web', 'browser_click_element', 'browser_subagent', 'manage_task', 'future_tool'].map(antigravityOfficeTool))
      .toEqual(['Bash', 'Write', 'Edit', 'Read', 'Grep', 'WebSearch', 'WebFetch', 'Agent', 'TodoWrite', 'future_tool']);
    expect(formatAntigravityUsage(usage)).toBe('13.2k tokens · 12.5k in · 699 out (330 thinking)');
    expect(formatAntigravityUsage({ input: 900, output: 20, thinking: 0, cacheRead: 400, total: 920 })).toBe('920 tokens · 900 in · 20 out · 400 cached');
    expect(providerName('antigravity')).toBe('Antigravity');
  });
  it('keeps unavailable usage distinct from zero in the activity totals', () => {
    const summary = activitySummary([turn('a'), turn('b', { usage: null, usageNote: 'Antigravity did not report token usage for this turn.' })]);
    expect(summary).toMatchObject({ total: 13228, missing: 1, turns: 2 });
  });
  it('reports the header status honestly', () => {
    expect(antigravityStatus(undefined, false).label).toBe('STARTING');
    expect(antigravityStatus(session({ busy: true }), false).label).toBe('WORKING');
    expect(antigravityStatus(session(), false).label).toBe('READY');
    expect(antigravityStatus(session({ error: 'x', recovery: 'login' }), false).label).toBe('SIGN IN');
    expect(antigravityStatus(session({ error: 'x', recovery: 'retry' }), false).label).toBe('ERROR');
    expect(antigravityStatus(session(), true).label).toBe('TERMINAL CLOSED');
    expect(Object.keys(ANTIGRAVITY_PERMISSIONS)).toEqual(['review', 'accept-edits', 'plan', 'skip']);
    expect(ANTIGRAVITY_PERMISSIONS.review.chat).toContain('auto-denied');
  });
  it('exports only real conversation text for forks and panel reads', () => {
    expect(antigravityTranscript([user, { id: 't', type: 'tool', name: 'run_command', state: 'done', at: 2 }, { id: 'a', type: 'assistant', text: 'Built.\n', state: 'done', at: 3 },
      { id: 'n', type: 'notice', level: 'denied', text: 'RunCommand', at: 4 }, { id: 'e', type: 'assistant', text: '  ', at: 5 }, { id: 'r', type: 'result', level: 'completed', text: 'SUCCESS', at: 6 }]))
      .toEqual([{ role: 'user', content: 'Run the build and fix what fails', timestamp: new Date(1).toISOString() }, { role: 'assistant', content: 'Built.', timestamp: new Date(3).toISOString() }]);
  });
  it('starts a forked terminal with the inherited conversation once, and an ordinary terminal with nothing', () => {
    const base = { agentProvider: 'antigravity' as const, cwd: 'C:/p', model: '', panelView: 'terminal' as const, systemPrompt: '', permissionMode: 'default', dangerouslySkipPermissions: false, allowedTools: [], maxBudget: 0, agentMode: false };
    const plain = useInstanceStore.getState().addInstance(base);
    expect(takeTerminalForkPrompt(plain)).toBeNull();
    const forked = useInstanceStore.getState().addInstance({ ...base, fork: { sourceId: 's', sourceName: 'Claude review', sourceProvider: 'claude', pending: true, openingMessage: 'Continue with the tests.',
      transcript: [{ role: 'user', content: 'Fix the layout' }, { role: 'assistant', content: 'The layout is fixed.' }] } });
    const prompt = takeTerminalForkPrompt(forked)!;
    expect(prompt).toContain('The layout is fixed.');
    expect(prompt.endsWith('Continue with the tests.')).toBe(true);
    expect(prompt.length).toBeLessThan(13_000);
    expect(useInstanceStore.getState().instances.get(forked)?.config.fork).toMatchObject({ pending: false });
    // A terminal restart must not replay the context or the opener.
    expect(takeTerminalForkPrompt(forked)).toBeNull();
  });
});
