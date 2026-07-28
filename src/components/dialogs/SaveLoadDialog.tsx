import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../../store/settingsStore';
import { serializeWorkspace, deserializeWorkspace } from '../../lib/workspaceSerializer';
import type { AdyFile, AdyFileV2, SavedWorkspace } from '../../types/session';

interface SaveLoadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'save' | 'load';
}

export const SaveLoadDialog: React.FC<SaveLoadDialogProps> = ({ isOpen, onClose, mode }) => {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { settings } = useSettingsStore();

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      const path = await save({
        filters: [{ name: 'Workspace', extensions: ['ady'] }],
        defaultPath: 'workspace.ady',
      });
      if (!path) return;

      const adyFile: AdyFileV2 = {
        version: 2,
        appVersion: '0.0.2-beta',
        createdAt: new Date().toISOString(),
        window: { x: 0, y: 0, width: 1200, height: 800, isMaximized: false },
        settings,
        workspace: serializeWorkspace(),
      };

      const content = JSON.stringify(adyFile, null, 2);
      await invoke('session_save_ady', { path, content });
      setStatus('Workspace saved successfully.');
      setError(null);
    } catch (err) {
      console.error('Failed to save workspace:', err);
      setError(String(err));
      setStatus(null);
    }
  };

  const handleLoad = async () => {
    try {
      const path = await open({
        filters: [{ name: 'Workspace', extensions: ['ady'] }],
        multiple: false,
      });
      if (!path) return;

      const raw = await invoke<string>('session_load_ady', { path: path as string });
      const adyFile = JSON.parse(raw) as AdyFile | AdyFileV2;

      if (adyFile.version === 2) {
        deserializeWorkspace(adyFile.workspace);
      } else {
        // Legacy v1 .ady: convert to the v2 SavedWorkspace shape the
        // serializer knows how to migrate
        const legacy: SavedWorkspace = {
          version: 2,
          savedAt: Date.now(),
          instances: adyFile.instances,
          layout: adyFile.layout && adyFile.tabOrder
            ? {
                tabOrder: adyFile.tabOrder,
                activeTabId: adyFile.activeTabId,
                focusedId: adyFile.layout.focusedId,
                layoutConfig: adyFile.layout.layoutConfig,
                panelRects: adyFile.layout.panelRects,
                stealFraction: adyFile.layout.stealFraction ?? 0.5,
                panelTypes: adyFile.layout.panelTypes,
                widgetKinds: adyFile.layout.widgetKinds,
              }
            : undefined,
        };
        deserializeWorkspace(legacy);
      }

      // Restore settings if present
      if (adyFile.settings) {
        useSettingsStore.getState().updateSettings(adyFile.settings);
      }

      setStatus('Workspace loaded successfully.');
      setError(null);
    } catch (err) {
      console.error('Failed to load workspace:', err);
      setError(String(err));
      setStatus(null);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === 'save' ? 'Save Workspace' : 'Load Workspace'}</h2>

        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
          {mode === 'save'
            ? 'Save the current workspace layout, instances, and settings to an .ady file.'
            : 'Load a workspace from an .ady file. This will create new instances with the saved configuration.'}
        </p>

        {status && (
          <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 12 }}>
            {status}
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>
            Error: {error}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            {status ? 'Done' : 'Cancel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={mode === 'save' ? handleSave : handleLoad}
          >
            {mode === 'save' ? 'Save...' : 'Load...'}
          </button>
        </div>
      </div>
    </div>
  );
};
