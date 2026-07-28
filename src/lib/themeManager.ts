import { useSettingsStore } from '../store/settingsStore';

export type ThemeId = 'dark' | 'gray' | 'light' | 'white' | 'nord';

export const THEMES: { id: ThemeId; label: string; isDark: boolean; preview: string }[] = [
  { id: 'dark', label: 'Dark', isDark: true, preview: '#1a1a2e' },
  { id: 'gray', label: 'Gray', isDark: true, preview: '#333333' },
  { id: 'light', label: 'Light', isDark: false, preview: '#e8e4f0' },
  { id: 'white', label: 'White', isDark: false, preview: '#fafafa' },
  { id: 'nord', label: 'Nord', isDark: true, preview: '#2e3440' },
];

export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function initThemeManager(): void {
  // Apply current theme
  const theme = (useSettingsStore.getState().settings as any).theme ?? 'dark';
  applyTheme(theme);

  // Subscribe to changes
  useSettingsStore.subscribe((state) => {
    const t = (state.settings as any).theme ?? 'dark';
    applyTheme(t);
  });
}

export function isThemeDark(theme: ThemeId): boolean {
  return THEMES.find(t => t.id === theme)?.isDark ?? true;
}
