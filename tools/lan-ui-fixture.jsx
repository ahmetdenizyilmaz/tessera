// Isolated browser fixture: no real processes, persisted workspaces or model calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { XTermView, clearTerminalState } from '../src/components/terminal/XTermView';
import { RemotePanel } from '../src/components/lan/RemotePanel';
import { readSharedTerminal } from '../src/lib/terminalSharing';
import { useInstanceStore } from '../src/store/instanceStore';
import { useLanStore } from '../src/store/lanStore';
import { syncRemoteGroups } from '../src/store/lanStore';
import { useGroupStore } from '../src/store/groupStore';
import { useLayoutStore } from '../src/store/layoutStore';
import { TabItem } from '../src/components/tabs/TabItem';
import { NetworkSettings } from '../src/components/settings/NetworkSettings';
import { GroupPreview } from '../src/components/groups/GroupPreview';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import '../src/styles/global.css';
import '../src/styles/terminal.css';

window.calls = [];
window.terminals = new Map();
const open = Terminal.prototype.open;
Terminal.prototype.open = function (node) {
  open.call(this, node);
  window.terminals.set(node.closest('[data-fixture-id]')?.dataset.fixtureId, this);
};
mockIPC(async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'pty_capabilities') return { windowsPty: { backend: 'conpty', buildNumber: 26200 } };
  if (command === 'codex_configure') return { generation: 'test', threadId: 'test-thread',
    thread: { id: 'test-thread', turns: [] }, events: [], requests: [], materialized: true, busy: false, alive: true };
  if (command === 'lan_read_terminal') return window.readRemote(args.panelId);
  if (command === 'lan_read_panel') return { messages: [{ role: 'assistant', content: 'Actual chat transcript' }] };
  return null;
}, { shouldMockEvents: true });

const panels = ['claude', 'codex'].map(provider => ({
  id: `host-${provider}`, name: `${provider} terminal`, cwd: 'C:/fixture', provider, kind: 'terminal',
  status: 'running', busy: false, awaitingUser: false, model: null, reachable: true,
}));
useInstanceStore.setState({ instances: new Map(panels.map(panel => [panel.id, {
  id: panel.id, name: panel.name, status: 'running', color: '#4a9eff',
  config: { agentProvider: panel.provider, panelView: 'terminal', cwd: panel.cwd, model: 'test',
    allowedTools: [], permissionMode: 'default', dangerouslySkipPermissions: false,
    systemPrompt: '', maxBudget: 0, agentMode: false },
}])) });
panels.push({ ...panels[0], id: 'host-chat', name: 'Chat', kind: 'chat' });
const setStatus = connected => useLanStore.getState().setStatus({
  sharing: true, deviceId: 'viewer', name: 'Viewer', fingerprint: '', port: 43721, addresses: [], pendingRequests: [],
  peers: [{ deviceId: 'owner', name: 'Host PC', address: '192.168.1.2', connected, registryReady: true, panels }],
});
setStatus(true);
const root = createRoot(document.getElementById('root'));
window.showOwner = (hidden = false) => root.render(<div style={{ display: 'flex', height: 600 }}>
  {panels.filter(p => p.kind === 'terminal' && !(hidden && p.provider === 'claude')).map(p =>
    <div key={p.id} data-fixture-id={p.id} style={{ width: 580, height: 550 }}><XTermView instanceId={p.id} /></div>)}
</div>);
function Viewer() {
  const order = useLayoutStore(s => s.tabOrder);
  const types = useLayoutStore(s => s.panelTypes);
  return <>
    <DndContext><SortableContext items={order}><div style={{ display: 'flex' }}>
      {order.map(id => <div key={id} data-fixture-tab={id}><TabItem id={id} onContextMenu={() => {}} /></div>)}
    </div></SortableContext></DndContext>
    <div style={{ display: 'flex', height: 600 }}>
      {order.map(id => <div key={id} data-fixture-id={id.slice('lan:owner:'.length)}
        data-panel-id={id} tabIndex={-1}
        data-fixture-group={types[id] === 'group' ? id : undefined} style={{ width: 380, height: 580 }}>
        {types[id] === 'group' ? <GroupPreview groupId={id} /> : <RemotePanel instanceId={id} />}
      </div>)}
    </div>
    <NetworkSettings />
  </>;
}
window.showViewer = () => {
  syncRemoteGroups();
  const group = [...useGroupStore.getState().groups.values()].find(g => g.remotePeerId === 'owner');
  if (useGroupStore.getState().getCurrentGroupId() !== group.id) {
    useGroupStore.getState().enterGroup(group.id);
    useGroupStore.getState().commitEnterGroup();
  }
  root.render(<Viewer />);
};
window.showGroups = () => {
  useGroupStore.getState().jumpToLevel(null);
  syncRemoteGroups();
  root.render(<Viewer />);
};
window.addLocalGroup = () => {
  const parent = useGroupStore.getState().createGroup(null, 'Local fixture group');
  const nested = useGroupStore.getState().createGroup(parent, 'Nested fixture group');
  useGroupStore.getState().addToGroup(nested, 'fixture-widget');
  useLayoutStore.setState(state => ({ panelTypes: { ...state.panelTypes, [nested]: 'group', 'fixture-widget': 'widget' },
    widgetKinds: { ...state.widgetKinds, 'fixture-widget': 'agents' } }));
  useLayoutStore.getState().addPanel(parent, 'group');
};
window.workspaceState = () => ({ order: useLayoutStore.getState().tabOrder,
  groups: [...useGroupStore.getState().groups.keys()], types: useLayoutStore.getState().panelTypes });
window.readSharedTerminal = readSharedTerminal;
window.output = (id, data) => emit(`pty-data-${id}`, data);
window.setConnected = setStatus;
window.clearShared = clearTerminalState;
