import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings } from '../types/session';

interface SettingsState {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: 'claude-sonnet-4-6',
  defaultPermissionMode: 'default',
  defaultSkipPermissions: true,
  defaultAgentMode: false,
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
      name: 'claude-gui-settings',
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
