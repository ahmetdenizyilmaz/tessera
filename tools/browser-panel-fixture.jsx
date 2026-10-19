import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { MosaicLayout } from '../src/components/layout/MosaicLayout';
import { TabBar } from '../src/components/tabs/TabBar';
import { useLayoutStore } from '../src/store/layoutStore';
import { useGroupStore } from '../src/store/groupStore';
import { usePluginStore } from '../src/store/pluginStore';
import { registerBuiltins } from '../src/lib/builtinPlugins';
import '../src/styles/global.css';
import '../src/styles/mosaic.css';

window.calls = [];
window.views = {};
mockWindows('main');
mockIPC(async (command, args) => {
  window.calls.push({ command, args });
  if (command === 'browser_panel_create') {
    await new Promise(resolve => setTimeout(resolve, 80));
    window.views[args.id] ??= { bounds: null, url: args.url || 'https://lichess.org/' };
  }
  if (command === 'browser_panel_bounds' && window.views[args.id]) window.views[args.id].bounds = args.bounds;
  if (command === 'browser_panel_status') return { url: window.views[args.id].url };
  if (command === 'browser_panel_close') delete window.views[args.id];
  return null;
}, { shouldMockEvents: true });
registerBuiltins();
window.layout = useLayoutStore;
window.groups = useGroupStore;
window.plugins = usePluginStore;
window.lichess = usePluginStore.getState().createInstance(new URLSearchParams(location.search).get('app') || 'lichess');
useLayoutStore.getState().addPanel(window.lichess, 'plugin');
window.gameGroup = useGroupStore.getState().createGroup(null, 'Games');
useLayoutStore.getState().addPanel(window.gameGroup, 'group');
useLayoutStore.getState().setFocused(window.lichess);
createRoot(document.getElementById('root')).render(<React.StrictMode>
  <div id="workspace" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <TabBar /><div style={{ flex: 1, minHeight: 0 }}><MosaicLayout /></div>
  </div>
</React.StrictMode>);
