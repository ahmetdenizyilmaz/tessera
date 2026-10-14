import React from 'react';
import {createRoot} from 'react-dom/client';
import {invoke} from '@tauri-apps/api/core';
import {MosaicLayout} from '../src/components/layout/MosaicLayout';
import {TabBar} from '../src/components/tabs/TabBar';
import {MenuBar} from '../src/components/menubar/MenuBar';
import {DetachedWindows} from '../src/components/windows/DetachedWindows';
import {usePluginStore} from '../src/store/pluginStore';
import {useLayoutStore} from '../src/store/layoutStore';
import {useWorkspaceWindowStore} from '../src/store/workspaceWindowStore';
import {useAppearanceStore} from '../src/store/appearanceStore';
import {usePanelLockStore} from '../src/store/panelLockStore';
import {registerBuiltins} from '../src/lib/builtinPlugins';
import * as creation from '../src/lib/newSessionActions';
import * as windows from '../src/lib/workspaceWindows';
import {closePanel} from '../src/lib/panelCleanup';
import {serializeWorkspace,deserializeWorkspace} from '../src/lib/workspaceSerializer';
import '../src/styles/global.css';
import '../src/styles/mosaic.css';
registerBuiltins();
await usePluginStore.getState().scanPlugins();
await invoke('validation_roster');
const noop=()=>{};
window.htmlTest={appearance:useAppearanceStore,invoke,plugins:usePluginStore,layout:useLayoutStore,workspaces:useWorkspaceWindowStore,locks:usePanelLockStore,creation,windows,closePanel,serializeWorkspace,deserializeWorkspace};
createRoot(document.getElementById('root')).render(<React.StrictMode><div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
  <MenuBar onNewInstance={noop} onQuickInstance={noop} onNewLlmChat={noop} onNewComputer={noop} onResumeSession={noop} onSessionHistory={noop} onSaveWorkspace={noop} onLoadWorkspace={noop} onSettings={noop} onAbout={noop}/>
  <TabBar/><div style={{flex:1,minHeight:0}}><MosaicLayout/></div></div><DetachedWindows/></React.StrictMode>);
