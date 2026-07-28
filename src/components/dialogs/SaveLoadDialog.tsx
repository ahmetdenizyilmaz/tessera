import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { AdyFile } from '../../types/session';
import type { InstanceConfig } from '../../types/instance';

interface SaveLoadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'save' | 'load';
}

export const SaveLoadDialog: React.FC<SaveLoadDialogProps> = ({ isOpen, onClose, mode }) => {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const instances = useInstanceStore((s) => s.instances);
  const { addInstance } = useInstanceStore();
  const layout = useLayoutStore();
  const { settings } = useSettingsStore();

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      const path = await save({
        filters: [{ name: 'Workspace', extensions: ['ady'] }],
        defaultPath: 'workspace.ady',
      });
      if (!path) return;

      const instanceArray = Array.from(instances.values()).map((inst) => ({
        id: inst.id,
        name: inst.name,
        color: inst.color,
        config: inst.config,
        claudeSessionId: inst.claudeSessionId,
      }));

      const adyFile: AdyFile = {
        version: 1,
        appVersion: '0.0.2-beta',
        createdAt: new Date().toISOString(),
        window: { x: 0, y: 0, width: 1200, height: 800, isMaximized: false },
        tabOrder: layout.tabOrder,
        activeTabId: layout.activeTabId,
        instances: instanceArray,
        settings,
        layout: {
          layoutConfig: layout.layoutConfig,
          panelRects: Object.fromEntries(layout.panelRects),
          stealFraction: layout.stealFraction,
          focusedId: layout.focusedId,
          panelTypes: layout.panelTypes,
        },
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
      const adyFile = JSON.parse(raw) as AdyFile;

      // Create ID mapping: old ID -> new ID
      const idMap = new Map<string, string>();

      for (const inst of adyFile.instances) {
        const config: InstanceConfig = inst.config;
        const newId = addInstance(config, inst.name);
        idMap.set(inst.id, newId);

        // Restore color
        useInstanceStore.getState().setColor(newId, inst.color);

        // Restore session ID if available
        if (inst.claudeSessionId) {
          useInstanceStore.getState().setClaudeSessionId(newId, inst.claudeSessionId);
        }
      }

      // Restore layout with remapped IDs
      if (adyFile.layout && adyFile.tabOrder) {
        const newTabOrder = adyFile.tabOrder
          .map((id) => idMap.get(id))
          .filter((id): id is string => id !== undefined);

        const newActiveTab = adyFile.activeTabId ? idMap.get(adyFile.activeTabId) ?? null : null;
        const newFocused = adyFile.layout.focusedId ? idMap.get(adyFile.layout.focusedId) ?? null : null;

        // Remap panel rects
        const newRects = new Map<string, { x: number; y: number; w: number; h: number }>();
        if (adyFile.layout.panelRects) {
          for (const [oldId, rect] of Object.entries(adyFile.layout.panelRects)) {
            const newId = idMap.get(oldId);
            if (newId) newRects.set(newId, rect);
          }
        }

        // Remap layout config panel order
        let newLayoutConfig = adyFile.layout.layoutConfig;
        if (newLayoutConfig) {
          newLayoutConfig = {
            ...newLayoutConfig,
            panelOrder: newLayoutConfig.panelOrder
              .map((id) => idMap.get(id))
              .filter((id): id is string => id !== undefined),
          };
        }

        // Remap panel types
        const newPanelTypes: Record<string, 'terminal' | 'computer' | 'llm' | 'widget' | 'group' | 'plugin'> = {};
        if (adyFile.layout.panelTypes) {
          for (const [oldId, type] of Object.entries(adyFile.layout.panelTypes)) {
            const newId = idMap.get(oldId);
            if (newId) newPanelTypes[newId] = type;
          }
        }

        // Remap widget kinds
        const newWidgetKinds: Record<string, string> = {};
        if ((adyFile.layout as Record<string, unknown>).widgetKinds) {
          for (const [oldId, kind] of Object.entries((adyFile.layout as Record<string, unknown>).widgetKinds as Record<string, string>)) {
            const newId = idMap.get(oldId);
            if (newId) newWidgetKinds[newId] = kind;
          }
        }

        layout.restoreLayout(
          newTabOrder,
          newActiveTab,
          newFocused,
          newLayoutConfig,
          newRects,
          adyFile.layout.stealFraction ?? 0.5,
          newPanelTypes,
          newWidgetKinds,
        );
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
