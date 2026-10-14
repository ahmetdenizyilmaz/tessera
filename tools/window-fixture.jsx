import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { MosaicLayout } from '../src/components/layout/MosaicLayout';
import { TabBar } from '../src/components/tabs/TabBar';
import { MenuBar } from '../src/components/menubar/MenuBar';
import { DetachedWindows } from '../src/components/windows/DetachedWindows';
import { useLayoutStore } from '../src/store/layoutStore';
import { useGroupStore } from '../src/store/groupStore';
import { usePluginStore } from '../src/store/pluginStore';
import { useWorkspaceWindowStore } from '../src/store/workspaceWindowStore';
import { registerBuiltins } from '../src/lib/builtinPlugins';
import * as windows from '../src/lib/workspaceWindows';
import * as creation from '../src/lib/newSessionActions';
import { serializeWorkspace, deserializeWorkspace } from '../src/lib/workspaceSerializer';
import '../src/styles/global.css';
import '../src/styles/mosaic.css';

const native = new URL(location.href).searchParams.has('native');
const addons = new URL(location.href).searchParams.has('addons');
const noop = () => {};
const realInvoke = native && window.__TAURI_INTERNALS__.invoke;
window.calls = [];
window.views = {};
window.dropTarget = { label: 'main', x: 100, y: 100 };
const children = new Map();
const handler = async (command, args) => {
  window.calls.push({ command, args });
  if (native && /^(browser_|workspace_|plugin:(window|webview|event)\|)/.test(command)) {
    const result = await realInvoke(command, args);
    if (command === 'browser_panel_bounds') window.views[args.id] = { bounds: args.bounds, label: args.windowLabel };
    if (command === 'browser_panel_close') delete window.views[args.id];
    return result;
  }
  if (command === 'workspace_drop_target') return window.dropTarget;
  if (command === 'workspace_window_place') children.set(args.label, windows.detachedViews.get(args.label.slice(10)));
  if (command === 'workspace_window_destroy') { children.get(args.label)?.close(); children.delete(args.label); }
  if (command === 'browser_panel_create') window.views[args.id] ??= { bounds: null };
  if (command === 'browser_panel_bounds' && window.views[args.id]) Object.assign(window.views[args.id], { bounds: args.bounds, label: args.windowLabel });
  if (command === 'browser_panel_status') return { url: 'https://lichess.org/analysis' };
  if (command === 'browser_panel_close') delete window.views[args.id];
  if (command === 'plugin:window|outer_position') return { x: 100, y: 100 };
  if (command === 'plugin:window|inner_size') return { width: 1000, height: 700 };
  if (command === 'plugin:window|is_minimized' || command === 'plugin:window|is_maximized') return false;
  if (command === 'plugin_read_file') return null;
  return null;
};
if (!native) { mockWindows('main'); mockIPC(handler, { shouldMockEvents: true }); }
registerBuiltins();
Object.assign(window, { layout: useLayoutStore, groups: useGroupStore, plugins: usePluginStore, workspaces: useWorkspaceWindowStore, windows, creation, serializeWorkspace, deserializeWorkspace });
creation.createPluginPanel('lichess');
window.lichess = useLayoutStore.getState().activeTabId;
usePluginStore.getState().setBrowserUrl(window.lichess, 'https://lichess.org/analysis');
creation.createGroupPanel();
window.group = useLayoutStore.getState().activeTabId;
creation.createPluginPanel('timer');
window.timer = useLayoutStore.getState().activeTabId;
useLayoutStore.getState().setFocused(window.lichess);
createRoot(document.getElementById('root')).render(<React.StrictMode>
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    {addons && <MenuBar onNewInstance={() => creation.openNewSessionWizard()} onQuickInstance={noop} onNewLlmChat={noop} onNewComputer={noop}
      onResumeSession={noop} onSessionHistory={noop} onSaveWorkspace={noop} onLoadWorkspace={noop} onSettings={noop} onAbout={noop}/>}
    <TabBar /><div style={{ flex: 1, minHeight: 0 }}><MosaicLayout /></div>
  </div><DetachedWindows />
</React.StrictMode>);
