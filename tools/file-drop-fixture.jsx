// Isolated UI fixture: real mosaic/xterm and native event routing, mocked IPC.
import './panel-ui-fixture.jsx';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { emit } from '@tauri-apps/api/event';
import { useFileDrop } from '../src/hooks/useFileDrop';
import { createGroupPanel } from '../src/lib/newSessionActions';

const originalInvoke = window.__TAURI_INTERNALS__.invoke;
window.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
  if (command === 'plugin:fs|read_dir') {
    const directory = window.deferDirectoryCheck
      ? await new Promise(resolve => { window.finishDirectoryCheck = resolve; })
      : args.path.endsWith('folder');
    if (!directory) throw new Error('Not a directory');
    return [];
  }
  const result = await originalInvoke(command, args, options);
  if (command === 'plugin:event|listen' && args.event === 'tauri://drag-leave') window.fileDropReady = true;
  return result;
};
window.droppedFolders = [];
const onFolderDropped = path => window.droppedFolders.push(path);
function FileDrop() { useFileDrop(onFolderDropped); return null; }
const root = createRoot(document.body.appendChild(document.createElement('div')));
root.render(<FileDrop />);
window.unmountFileDrop = () => root.unmount();
window.emitFileDrag = (kind, payload = {}) => emit(`tauri://drag-${kind}`, payload);
window.createDropGroup = createGroupPanel;
window.showMosaic(3);
