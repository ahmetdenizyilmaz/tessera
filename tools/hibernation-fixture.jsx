// Isolated browser fixture: all native IPC is mocked, no user agent is touched.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { MosaicLayout } from '../src/components/layout/MosaicLayout';
import { usePanelHibernation } from '../src/hooks/usePanelHibernation';
import { useInstanceStore } from '../src/store/instanceStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { useCodexStore } from '../src/store/codexStore';
import { useSettingsStore } from '../src/store/settingsStore';
import { usePanelHibernationStore } from '../src/store/panelHibernationStore';
import { GeneralSettings } from '../src/components/settings/GeneralSettings';
import { serializeWorkspace, deserializeWorkspace } from '../src/lib/workspaceSerializer';
import { isPanelViewed } from '../src/lib/panelActivityClock';
import { ensureCodex } from '../src/lib/codexBridge';
import { hibernatePanel } from '../src/lib/panelHibernation';
import '../src/styles/global.css';
import '../src/styles/chat.css';
import '../src/styles/codex.css';
import '../src/styles/mosaic.css';

mockWindows('main'); window.calls = [];
mockIPC(async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'codex_discover') return { models: [], account: { account: null } };
  if (command === 'codex_configure') return {
    generation: crypto.randomUUID(), threadId: args.threadId,
    thread: { id: args.threadId, cwd: args.config.cwd, turns: [{ id: 'turn-1', status: 'completed', items: [
      { id: 'answer', type: 'agentMessage', text: 'The implementation and tests are complete. This saved answer must survive hibernation.' },
    ] }] }, events: [], requests: [], busy: false, alive: true, materialized: true, resumable: true,
  };
  if (command === 'pty_capabilities') return { windowsPty: { backend: 'conpty', buildNumber: 26200 } };
  if (command === 'codex_terminal_spawn') {
    setTimeout(() => emit(`pty-data-${args.id}`, '\x1b[2J\x1b[HCompleted work\r\n\r\nAll tests passed. Your terminal content stays visible here.\r\n\r\n› Ask Codex to do anything'), 40);
    return;
  }
  if (command === 'panel_hibernate') {
    if (window.failSleep) throw new Error('Preview could not be saved');
    localStorage.setItem(`preview:${args.previewId}`, JSON.stringify(args.preview)); return;
  }
  if (command === 'panel_preview_read') return JSON.parse(localStorage.getItem(`preview:${args.previewId}`));
  if (['list_slash_commands', 'list_project_files'].includes(command)) return [];
  return null;
}, { shouldMockEvents: true });

useSettingsStore.getState().updateSettings({ panelHibernationMinutes: 60 });
const saved = localStorage.getItem('hibernation-test-workspace');
if (saved) deserializeWorkspace(JSON.parse(saved));
else {
  for (const [name, panelView] of [['Current panel', 'chat'], ['Old terminal', 'terminal']]) {
    const id = useInstanceStore.getState().addInstance({ agentProvider: 'codex', panelView,
      cwd: 'C:/fixture', model: 'test-model', systemPrompt: '', permissionMode: 'bypassPermissions',
      dangerouslySkipPermissions: true, allowedTools: [], maxBudget: 0, agentMode: false,
      codex: { sandbox: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'user' } }, name);
    useInstanceStore.getState().updateInstance(id, { status: 'running', codexThreadId: `thread-${name}`, codexHasTurns: true, codexResumable: true });
    useLayoutStore.getState().addPanel(id, 'terminal');
  }
  useLayoutStore.getState().setFocused([...useInstanceStore.getState().instances.keys()][0]);
}
Object.assign(window, {
  instances: useInstanceStore, codex: useCodexStore, hibernation: usePanelHibernationStore,
  ensureCodex, hibernatePanel, isPanelViewed,
  saveWorkspace: () => localStorage.setItem('hibernation-test-workspace', JSON.stringify(serializeWorkspace())),
  markOld: id => useInstanceStore.getState().updateInstance(id, { hibernation: { sleeping: false, idleMs: 3600_000 } }),
});
function Fixture() {
  usePanelHibernation();
  return <><div style={{ position: 'relative', height: '70vh' }}>
    <MosaicLayout />
  </div><div style={{ padding: 12, height: '28vh', overflow: 'auto' }}><GeneralSettings /></div></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
