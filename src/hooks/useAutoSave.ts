import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSessionStore } from '../store/sessionStore';
import type { SavedWorkspace } from '../types/session';
import type { PanelRect } from '../types/session';

const AUTOSAVE_KEY = 'claude-gui-autosave';
const AUTOSAVE_INTERVAL = 30000; // 30 seconds

export function useAutoSave() {
  const restoredRef = useRef(false);

  // Restore on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;

      const saved: SavedWorkspace = JSON.parse(raw);
      if (saved.version !== 2 || !saved.instances?.length) return;

      // ID remapping: old IDs -> new IDs
      const idMap = new Map<string, string>();

      for (const inst of saved.instances) {
        const newId = useInstanceStore.getState().addInstance(
          inst.config,
          inst.name,
        );
        idMap.set(inst.id, newId);

        // Restore color and session ID
        if (inst.color) {
          useInstanceStore.getState().setColor(newId, inst.color);
        }
        if (inst.claudeSessionId) {
          useInstanceStore.getState().setClaudeSessionId(newId, inst.claudeSessionId);
        }
      }

      // Restore layout with remapped IDs
      if (saved.layout) {
        const remapId = (id: string) => idMap.get(id) ?? id;
        const newTabOrder = saved.layout.tabOrder.map(remapId);
        const newActiveTabId = saved.layout.activeTabId ? remapId(saved.layout.activeTabId) : null;
        const newFocusedId = saved.layout.focusedId ? remapId(saved.layout.focusedId) : null;

        let newLayoutConfig = saved.layout.layoutConfig;
        if (newLayoutConfig) {
          newLayoutConfig = {
            ...newLayoutConfig,
            panelOrder: newLayoutConfig.panelOrder.map(remapId),
          };
        }

        const newPanelRects = new Map<string, PanelRect>();
        for (const [oldId, rect] of Object.entries(saved.layout.panelRects)) {
          newPanelRects.set(remapId(oldId), rect);
        }

        // Remap panel types
        const newPanelTypes: Record<string, 'terminal' | 'computer' | 'llm' | 'widget' | 'group' | 'plugin'> = {};
        if (saved.layout.panelTypes) {
          for (const [oldId, type] of Object.entries(saved.layout.panelTypes)) {
            newPanelTypes[remapId(oldId)] = type;
          }
        }

        // Remap widget kinds
        const newWidgetKinds: Record<string, string> = {};
        if ((saved.layout as Record<string, unknown>).widgetKinds) {
          for (const [oldId, kind] of Object.entries((saved.layout as Record<string, unknown>).widgetKinds as Record<string, string>)) {
            newWidgetKinds[remapId(oldId)] = kind;
          }
        }

        useLayoutStore.getState().restoreLayout(
          newTabOrder,
          newActiveTabId,
          newFocusedId,
          newLayoutConfig,
          newPanelRects,
          saved.layout.stealFraction,
          newPanelTypes,
          newWidgetKinds,
        );
      } else {
        // No saved layout: add panels for each instance
        for (const inst of saved.instances) {
          const newId = idMap.get(inst.id);
          if (newId) {
            useLayoutStore.getState().addPanel(newId);
          }
        }
      }
    } catch (err) {
      console.error('Failed to restore auto-save:', err);
    }
  }, []);

  // Persist active sessions on window close
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen('tauri://close-requested', () => {
      const instances = useInstanceStore.getState().instances;
      const sessionStore = useSessionStore.getState();
      instances.forEach((inst) => {
        sessionStore.addSession({
          instanceId: inst.id,
          name: inst.name,
          projectPath: inst.config.cwd,
          messageCount: 0,
          startedAt: Date.now(),
          endedAt: Date.now(),
        });
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  // Auto-save on interval
  useEffect(() => {
    const autoSave = useSettingsStore.getState().settings.autoSave;
    if (!autoSave) return;

    const timer = setInterval(() => {
      try {
        const instances = useInstanceStore.getState().instances;
        if (instances.size === 0) return;

        const layoutState = useLayoutStore.getState();

        const workspace: SavedWorkspace = {
          version: 2,
          instances: Array.from(instances.values()).map((inst) => ({
            id: inst.id,
            name: inst.name,
            color: inst.color,
            config: inst.config,
            claudeSessionId: inst.claudeSessionId,
          })),
          savedAt: Date.now(),
          layout: {
            tabOrder: layoutState.tabOrder,
            activeTabId: layoutState.activeTabId,
            focusedId: layoutState.focusedId,
            layoutConfig: layoutState.layoutConfig,
            panelRects: Object.fromEntries(layoutState.panelRects),
            stealFraction: layoutState.stealFraction,
            panelTypes: layoutState.panelTypes,
          },
        };

        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(workspace));
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, AUTOSAVE_INTERVAL);

    return () => clearInterval(timer);
  }, []);
}
