/**
 * One-time migration of persisted localStorage keys from the app's former name.
 *
 * This module is imported FIRST in main.tsx, before any zustand store hydrates,
 * so the renamed keys already hold the previous data by the time a store reads
 * them. It is deliberately defensive: any failure just means starting fresh,
 * which is harmless. Safe to remove once all installs have migrated.
 */
const KEY_RENAMES: Record<string, string> = {
  'claude-gui-settings': 'tessera-settings',
  'claude-gui-autosave': 'tessera-autosave',
  'claude-gui-groups': 'tessera-groups',
  'claude-gui-sessions': 'tessera-sessions',
  'claude-gui-llm-chats': 'tessera-llm-chats',
  'claude-gui-office': 'tessera-office',
};

try {
  for (const [oldKey, newKey] of Object.entries(KEY_RENAMES)) {
    if (localStorage.getItem(newKey) === null) {
      const value = localStorage.getItem(oldKey);
      if (value !== null) localStorage.setItem(newKey, value);
    }
  }
} catch {
  // localStorage unavailable/blocked — nothing to migrate, start fresh.
}

export {};
