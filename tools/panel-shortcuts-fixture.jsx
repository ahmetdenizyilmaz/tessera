// Isolated browser fixture: real panels and keyboard handling, mocked native IPC.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { MosaicLayout } from '../src/components/layout/MosaicLayout';
import { TabItem } from '../src/components/tabs/TabItem';
import { SaveLoadDialog } from '../src/components/dialogs/SaveLoadDialog';
import { useAutoSave } from '../src/hooks/useAutoSave';
import { useInstanceStore } from '../src/store/instanceStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { useGroupStore } from '../src/store/groupStore';
import { usePanelShortcutStore } from '../src/store/panelShortcutStore';
import { installPanelShortcuts, focusShortcutPanel } from '../src/lib/panelShortcuts';
import { AUTOSAVE_KEY, restoreOnce } from '../src/lib/workspaceSerializer';
import '../src/styles/global.css';
import '../src/styles/chat.css';
import '../src/styles/codex.css';
import '../src/styles/mosaic.css';
import '@xterm/xterm/css/xterm.css';

window.calls = [];
mockWindows('main');
mockIPC(async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'plugin:dialog|save' || command === 'plugin:dialog|open') return 'C:\\fixture\\shortcuts.ady';
  if (command === 'session_save_ady') { window.savedWorkspaceFile = args.content; return null; }
  if (command === 'session_load_ady') return window.savedWorkspaceFile;
  if (command === 'pty_capabilities') return { windowsPty: { backend: 'conpty', buildNumber: 26200 } };
  if (command === 'codex_discover') return { models: [{ id: 'test', model: 'test-model', displayName: 'Test model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], inputModalities: ['text'] }], account: { account: { type: 'chatgpt' } } };
  if (command === 'codex_configure') return {
    generation: 'fixture', threadId: args.threadId || `thread-${args.id}`,
    thread: { id: args.threadId || `thread-${args.id}`, cwd: 'C:\\scratch', turns: [] },
    events: [], requests: [], materialized: true, busy: false, alive: true,
  };
  if (command === 'codex_send') return {};
  if (command === 'list_slash_commands' || command === 'list_project_files') return [];
  return null;
}, { shouldMockEvents: true });
window.terminals = new Map();
const open = Terminal.prototype.open;
Terminal.prototype.open = function (container) {
  const result = open.call(this, container);
  window.terminals.set(container.closest('[data-panel-id]')?.dataset.panelId, this);
  return result;
};
window.layout = useLayoutStore;
window.groups = useGroupStore;
window.shortcuts = usePanelShortcutStore;
window.focusPanel = focusShortcutPanel;
window.closeAppForTest = () => emit('tauri://close-requested');
const saved = localStorage.getItem(AUTOSAVE_KEY);
restoreOnce();
if (!saved) {
  const add = (id, name, provider, panelView) => {
    useInstanceStore.setState(s => ({ instances: new Map([...s.instances, [id, {
      id, name, color: '#4a9eff', status: 'running',
      config: { agentProvider: provider, panelView, cwd: 'C:\\scratch', model: 'test-model', systemPrompt: '', codex: { effort: 'medium' } },
      codexThreadId: provider === 'codex' ? `thread-${id}` : undefined,
      codexHasTurns: provider === 'codex',
    }]]) }));
    useLayoutStore.getState().addPanel(id, 'terminal');
  };
  add('chat', 'Codex chat', 'codex', 'chat');
  add('terminal', 'Codex terminal', 'codex', 'terminal');
  const group = useGroupStore.getState().createGroup(null, 'Nested conversations');
  useLayoutStore.getState().addPanel(group, 'group');
  useGroupStore.getState().enterGroup(group);
  useGroupStore.getState().commitEnterGroup();
  add('nested', 'Claude terminal', 'claude', 'terminal');
  useGroupStore.getState().jumpToLevel(null);
  useGroupStore.getState().clearTransition();
  useLayoutStore.getState().setActiveTab('chat');
  useLayoutStore.getState().setFocused('chat');
}
function Fixture() {
  useAutoSave();
  const [dialog, setDialog] = useState(null);
  window.showSaveLoad = setDialog;
  const ids = useLayoutStore(s => s.tabOrder);
  return <DndContext><SortableContext items={ids}>
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="tab-bar">{ids.map(id => <TabItem key={id} id={id} onContextMenu={() => {}} />)}</div>
      <div style={{ flex: 1, minHeight: 0 }}><MosaicLayout /></div>
      {dialog && <SaveLoadDialog key={dialog} isOpen mode={dialog} onClose={() => setDialog(null)} />}
    </div>
  </SortableContext></DndContext>;
}
installPanelShortcuts();
createRoot(document.getElementById('root')).render(<Fixture />);
