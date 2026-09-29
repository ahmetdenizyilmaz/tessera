// Isolated browser fixture: real panel/group UI with mocked native sessions.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { MosaicLayout } from '../src/components/layout/MosaicLayout';
import { TabBar } from '../src/components/tabs/TabBar';
import { useInstanceStore } from '../src/store/instanceStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { useGroupStore } from '../src/store/groupStore';
import { serializeWorkspace, deserializeWorkspace } from '../src/lib/workspaceSerializer';
import '../src/styles/global.css';
import '../src/styles/chat.css';
import '../src/styles/codex.css';
import '../src/styles/mosaic.css';
import '@xterm/xterm/css/xterm.css';

window.calls = [];
mockWindows('main');
mockIPC(async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'pty_capabilities') return { windowsPty: { backend: 'conpty', buildNumber: 26200 } };
  if (command === 'codex_discover') return {
    models: [{ id: 'test', model: 'test-model', displayName: 'Test model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], inputModalities: ['text'] }],
    account: { account: { type: 'chatgpt' } },
  };
  if (command === 'codex_configure') return {
    generation: 'fixture', threadId: `thread-${args.id}`,
    thread: { id: `thread-${args.id}`, cwd: 'C:\\scratch', turns: [] },
    events: [], requests: [], materialized: true, busy: false, alive: true,
  };
  if (command === 'list_slash_commands' || command === 'list_project_files') return [];
  return null;
}, { shouldMockEvents: true });

window.layout = useLayoutStore;
window.groups = useGroupStore;
window.roundTrip = () => {
  const saved = serializeWorkspace();
  deserializeWorkspace(JSON.parse(JSON.stringify(saved)));
  return Object.fromEntries([...useInstanceStore.getState().instances.values()].map(instance => [instance.name, instance.id]));
};
for (const [id, name, panelView] of [['chat', 'Planning chat', 'chat'], ['terminal', 'Build terminal', 'terminal']]) {
  useInstanceStore.setState(s => ({ instances: new Map([...s.instances, [id, {
    id, name, color: '#4a9eff', status: 'running',
    config: { agentProvider: 'codex', panelView, cwd: 'C:\\scratch', model: 'test-model', systemPrompt: '', codex: { effort: 'medium' } },
    codexThreadId: `thread-${id}`, codexHasTurns: true,
  }]]) }));
  useLayoutStore.getState().addPanel(id, 'terminal');
}
for (const name of ['Work', 'Research']) {
  const id = useGroupStore.getState().createGroup(null, name);
  useLayoutStore.getState().addPanel(id, 'group');
}
useLayoutStore.getState().setActiveTab('chat');
useLayoutStore.getState().setFocused('chat');
createRoot(document.getElementById('root')).render(
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <TabBar />
    <div style={{ flex: 1, minHeight: 0 }}><MosaicLayout /></div>
  </div>,
);
