import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { applyForkToInstance, cancelFork, startFork, submitForkOpeningToTerminal, takeForkOpeningMessage } from './forkActions';
import { emptyCodexState } from './codexReducer';
import { useCodexStore } from '../store/codexStore';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useWizardStore } from '../store/wizardStore';
import type { InstanceConfig } from '../types/instance';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => 'forked-claude-session') }));
vi.mock('./newSessionActions', () => ({ openNewSessionWizard: vi.fn() }));
vi.mock('./toast', () => ({ notify: vi.fn() }));
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  } });
});

const config: InstanceConfig = { cwd: 'C:/test', model: 'test', systemPrompt: '', permissionMode: 'default',
  dangerouslySkipPermissions: false, allowedTools: [], maxBudget: 0, agentMode: false };
const transcript = [{ role: 'user', content: 'Fix the panel layout.' }, { role: 'assistant', content: 'The layout fix is ready.' }];
let sourceId: string;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useSettingsStore.getState().resetSettings();
  useWizardStore.getState().reset();
  useInstanceStore.setState({ instances: new Map() });
  useLayoutStore.setState({ tabOrder: [], panelTypes: {} });
  sourceId = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'codex', panelView: 'terminal' }, 'Source Codex');
  useCodexStore.setState({ sessions: { [sourceId]: { ...emptyCodexState('fork-test'), items: [
    { id: 'user', type: 'userMessage', content: [{ type: 'text', text: transcript[0].content }] },
    { id: 'assistant', type: 'agentMessage', text: transcript[1].content },
  ] } } });
});
afterEach(() => { cancelFork(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['chat', 'terminal'] as const)('forks Codex into Claude %s with the same history and no automatic message', async (panelView) => {
  await startFork(sourceId);
  expect(useWizardStore.getState().fork).toMatchObject({ openingMessage: '', messageCount: 2 });
  const target = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'claude', panelView }, 'Target Claude');
  await applyForkToInstance(target);
  expect(invoke).toHaveBeenCalledWith('session_write_fork', { projectPath: 'C:/test', messages: transcript, model: 'test' });
  expect(useInstanceStore.getState().instances.get(target)).toMatchObject({ claudeSessionId: 'forked-claude-session',
    config: { fork: { sourceProvider: 'codex', transcript, pending: false } } });
  expect(takeForkOpeningMessage(target)).toBeNull();
  vi.mocked(invoke).mockClear();
  submitForkOpeningToTerminal(target);
  await vi.runAllTimersAsync();
  expect(invoke).not.toHaveBeenCalled();
});

it('still sends a custom opening message once when the user chooses one', async () => {
  useSettingsStore.getState().updateSettings({ forkOpeningMessage: 'Review the remaining changes.' });
  await startFork(sourceId);
  const target = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'claude', panelView: 'terminal' }, 'Target Claude');
  await applyForkToInstance(target);
  vi.mocked(invoke).mockClear();
  submitForkOpeningToTerminal(target);
  submitForkOpeningToTerminal(target);
  await vi.runAllTimersAsync();
  expect(invoke).toHaveBeenCalledExactlyOnceWith('pty_submit', { id: target, text: 'Review the remaining changes.' });
});

it('keeps the history for the first user message if native session creation fails, without a summary prompt', async () => {
  await startFork(sourceId);
  const target = useInstanceStore.getState().addInstance({ ...config, agentProvider: 'claude', panelView: 'chat' }, 'Target Claude');
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Test session write failed'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await applyForkToInstance(target);
  expect(useInstanceStore.getState().instances.get(target)?.config.fork).toMatchObject({ transcript, pending: true });
  expect(takeForkOpeningMessage(target)).toBeNull();
});
