// Isolated focus regression fixture: real navigation and layout, no live sessions.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { MenuBar } from '../src/components/menubar/MenuBar';
import { TabBar } from '../src/components/tabs/TabBar';
import { MosaicLayout } from '../src/components/layout/MosaicLayout';
import { StatusBar } from '../src/components/statusbar/StatusBar';
import { useLayoutStore } from '../src/store/layoutStore';
import { useGroupStore } from '../src/store/groupStore';
import { useWizardStore } from '../src/store/wizardStore';
import { openNewSessionWizard } from '../src/lib/newSessionActions';
import '../src/styles/global.css';
import '../src/styles/mosaic.css';

mockWindows('main');
mockIPC(() => null, { shouldMockEvents: true });
window.layout = useLayoutStore;
window.groups = useGroupStore;
window.wizard = useWizardStore;
for (let i = 1; i <= 4; i++) {
  const id = useGroupStore.getState().createGroup(null, `Other panel ${i}`);
  useLayoutStore.getState().addPanel(id, 'group');
}
const noop = () => {};
createRoot(document.getElementById('root')).render(
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <MenuBar onNewInstance={openNewSessionWizard} onQuickInstance={noop}
      onNewLlmChat={noop} onNewComputer={noop} onResumeSession={noop}
      onSessionHistory={noop} onSaveWorkspace={noop} onLoadWorkspace={noop}
      onSettings={noop} onAbout={noop} />
    <TabBar />
    <div style={{ flex: 1, minHeight: 0 }}><MosaicLayout /></div>
    <StatusBar onNewInstance={openNewSessionWizard} />
  </div>,
);
