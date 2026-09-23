import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppSettings } from '../types/session';
import { DEFAULT_OPENCODE_OPTIONS } from '../lib/opencodeConfig';

interface SettingsState {
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  resetSettings: () => void;
}

const LEGACY_FORK_OPENING_MESSAGE = 'Summarize the current situation in short, then wait for my next instruction.';

const DEFAULT_SETTINGS: AppSettings = {
  openCodeDefaults: { ...DEFAULT_OPENCODE_OPTIONS },
  defaultModel: 'opus',
  // 'auto' is a real CLI permission mode (choices: acceptEdits, auto,
  // bypassPermissions, manual, dontAsk, plan). Previously this was 'default'
  // plus dangerouslySkipPermissions, i.e. every new instance bypassed every
  // permission check.
  defaultPermissionMode: 'auto',
  defaultSkipPermissions: false,
  defaultAgentMode: false,
  defaultCodexPermissionMode: 'workspace-write',
  lastModel: '',
  lastPanelView: 'chat',
  lastCwd: '',
  forkOpeningMessage: '',
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
      version: 2,
      // v0 → v1: new instances defaulted to sonnet with permissions bypassed.
      // Persisted settings shadow the defaults above, so without this the new
      // values would never reach anyone who has used the app before.
      migrate: (persisted, version) => {
        const state = persisted as SettingsState | undefined;
        if (!state?.settings) return state as SettingsState;
        const settings = { ...state.settings };
        if (version < 1) {
          settings.defaultModel = 'opus';
          settings.defaultPermissionMode = 'auto';
          settings.defaultSkipPermissions = false;
        }
        // v1 → v2: forks inherit their history without automatically asking for
        // a summary. Clear the old stock prompt, but keep user-written openers.
        if (version < 2 && settings.forkOpeningMessage?.trim() === LEGACY_FORK_OPENING_MESSAGE) {
          settings.forkOpeningMessage = '';
        }
        return {
          ...state,
          settings,
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
