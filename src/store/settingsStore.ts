import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings } from '../types/session';

interface SettingsState {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: 'opus',
  // 'auto' is a real CLI permission mode (choices: acceptEdits, auto,
  // bypassPermissions, manual, dontAsk, plan). Previously this was 'default'
  // plus dangerouslySkipPermissions, i.e. every new instance bypassed every
  // permission check.
  defaultPermissionMode: 'auto',
  defaultSkipPermissions: false,
  defaultAgentMode: false,
  lastModel: '',
  lastPanelView: 'chat',
  lastCwd: '',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
  autoSave: true,
  autoSaveDir: '',
  systemMonitorInterval: 3000,
  usagePollingInterval: 600000,
  planBudgetUsd: 0,
  ollamaBaseUrl: '',
  lmstudioBaseUrl: '',
  openaiDefaultModel: 'gpt-4o',
  geminiDefaultModel: 'gemini-2.0-flash',
  theme: 'dark',
  lastSessionPreset: null,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },

      updateSettings: (partial: Partial<AppSettings>) => {
        set((state) => ({
          settings: { ...state.settings, ...partial },
        }));
      },

      resetSettings: () => {
        set({ settings: { ...DEFAULT_SETTINGS } });
      },
    }),
    {
      name: 'tessera-settings',
      version: 1,
      // v0 → v1: new instances defaulted to sonnet with permissions bypassed.
      // Persisted settings shadow the defaults above, so without this the new
      // values would never reach anyone who has used the app before.
      migrate: (persisted, version) => {
        const state = persisted as SettingsState | undefined;
        if (!state?.settings) return state as SettingsState;
        if (version >= 1) return state;
        return {
          ...state,
          settings: {
            ...state.settings,
            defaultModel: 'opus',
            defaultPermissionMode: 'auto',
            defaultSkipPermissions: false,
          },
        };
      },
      merge: (persisted, current) => {
        const p = persisted as SettingsState | undefined;
        return {
          ...current,
          settings: {
            ...current.settings,
            ...(p?.settings ?? {}),
          },
        };
      },
    },
  ),
);
