// Real Local PC wizard and group navigation; native connections are mocked.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { LanPairRequestDialog } from '../src/components/lan/LanPairRequestDialog';
import { TabBar } from '../src/components/tabs/TabBar';
import { MosaicLayout } from '../src/components/layout/MosaicLayout';
import { useLayoutStore } from '../src/store/layoutStore';
import { useGroupStore } from '../src/store/groupStore';
import { closeRemoteGroup, syncRemoteGroups, useLanStore, initLanBridge } from '../src/store/lanStore';
import { openNewSessionWizard } from '../src/lib/newSessionActions';
import '../src/styles/global.css';
import '../src/styles/mosaic.css';
import '../src/styles/chat.css';

const status = connected => ({
  sharing: true, deviceId: 'local', name: 'This PC', fingerprint: '', port: 43721,
  addresses: ['192.168.88.88:43721'], pendingRequests: [],
  peers: [{ deviceId: 'other-pc', name: 'Other PC', address: '192.168.88.62:43721', connected, registryReady: true,
    panels: [{ id: 'shared', name: 'Shared chat', kind: 'chat', provider: 'claude', cwd: 'C:/fixture', status: 'running', busy: false, awaitingUser: false, reachable: true, model: null }] }],
});
mockWindows('main');
let nativeStatus = status(false), revision = 0;
const snapshot = () => ({ ...nativeStatus, revision: ++revision });
window.calls = [];
mockIPC((command, args) => {
  window.calls.push({ command, args });
  if (command === 'lan_status') return snapshot();
  if (command === 'lan_respond_pair_request') {
    if (window.failApproval) throw Error('Could not answer this request');
    nativeStatus = { ...nativeStatus, pendingRequests: [] };
    return snapshot();
  }
  if (command === 'lan_request_pair' || command === 'lan_connect') {
    return new Promise((resolve, reject) => {
      window.completeConnection = outcome => outcome === 'error'
        ? reject(new Error('Could not reach the other computer'))
        : resolve((nativeStatus = status(outcome !== 'offline'), snapshot()));
    });
  }
  if (command === 'lan_read_panel') return { messages: [{ role: 'assistant', content: 'Remote connection fixture' }] };
  return null;
}, { shouldMockEvents: true });
window.layout = useLayoutStore;
window.groups = useGroupStore;
window.lan = useLanStore;
window.receiveRequest = async (missEvent = false) => {
  const previous = snapshot();
  nativeStatus = { ...nativeStatus, pendingRequests: [{ requestId: 'request', deviceId: 'new-pc', name: 'Requesting PC', address: '192.168.88.63', fingerprint: 'ABCD-1234', receivedAt: 1 }] };
  if (!missEvent) {
    await emit('lan-state', snapshot());
    // Simulate an older IPC reply arriving after the native approval event.
    useLanStore.getState().setStatus(previous);
  }
};
const outer = useGroupStore.getState().createGroup(null, 'Local work');
useLayoutStore.getState().addPanel(outer, 'group');
useLanStore.getState().setStatus(status(false));
syncRemoteGroups();
const scenario = new URLSearchParams(location.search).get('scenario');
if (scenario === 'nested-hidden') {
  closeRemoteGroup('other-pc');
  useGroupStore.getState().enterGroup(outer);
  useGroupStore.getState().commitEnterGroup();
  const inner = useGroupStore.getState().createGroup(outer, 'Nested work');
  useLayoutStore.getState().addPanel(inner, 'group');
  useGroupStore.getState().enterGroup(inner);
  useGroupStore.getState().commitEnterGroup();
}
openNewSessionWizard();
void initLanBridge();
createRoot(document.getElementById('root')).render(
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <TabBar />
    <div style={{ flex: 1, minHeight: 0 }}><MosaicLayout /></div>
    <LanPairRequestDialog />
  </div>,
);
