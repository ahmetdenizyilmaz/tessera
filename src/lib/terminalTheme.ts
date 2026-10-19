import type { ITheme, Terminal } from '@xterm/xterm';
import { getPanelBackground, useAppearanceStore } from '../store/appearanceStore';
import { backgroundForeground } from './panelBackground';
import { useSettingsStore } from '../store/settingsStore';
import { isThemeDark, type ThemeId } from './themeManager';

/** ANSI palette shared by local terminals and their LAN viewers. */
export const terminalTheme: ITheme = {
  background: '#1a1a2e', foreground: '#e0e0e0', cursor: '#4a9eff',
  selectionBackground: 'rgba(74, 158, 255, 0.3)',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.15)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.25)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.30)',
  black: '#2d2d2d', brightBlack: '#555555', red: '#ff6b6b', brightRed: '#ff8787',
  green: '#51cf66', brightGreen: '#69db7c', yellow: '#ffd43b', brightYellow: '#ffe066',
  blue: '#4a9eff', brightBlue: '#74b9ff', magenta: '#cc5de8', brightMagenta: '#da77f2',
  cyan: '#20c997', brightCyan: '#38d9a9', white: '#e0e0e0', brightWhite: '#ffffff',
};

// Saturated, darker ANSI colors stay readable on light backgrounds.
const lightAnsiTheme: ITheme = {
  black: '#24292f', brightBlack: '#6e7781', red: '#b42318', brightRed: '#cf222e',
  green: '#116329', brightGreen: '#1a7f37', yellow: '#785900', brightYellow: '#8a6500',
  blue: '#0550ae', brightBlue: '#0969da', magenta: '#6639ba', brightMagenta: '#8250df',
  cyan: '#0e6a75', brightCyan: '#1b7c83', white: '#57606a', brightWhite: '#24292f',
};

export function panelTerminalTheme(id: string): ITheme {
  const background = getPanelBackground(id);
  // Read the same CSS palette as the surrounding panel. xterm 6 accepts the
  // theme's oklch colors, so the canvas and DOM use one source of truth.
  const style = typeof document === 'undefined' ? undefined : getComputedStyle(document.documentElement);
  const color = (variable: string, fallback: string) => style?.getPropertyValue(variable).trim() || fallback;
  const followsTheme = background.mode === 'theme';
  const light = followsTheme
    ? !isThemeDark(useSettingsStore.getState().settings.theme as ThemeId)
    : backgroundForeground(background) === '#17212d';
  const foreground = followsTheme ? color('--text-primary', terminalTheme.foreground!) : backgroundForeground(background);
  const cursor = followsTheme ? color('--accent', terminalTheme.cursor!) : light ? '#0550ae' : terminalTheme.cursor;
  const backgroundColor = followsTheme ? color('--bg-primary', terminalTheme.background!) : '#00000000';
  return {
    ...terminalTheme, ...(light ? lightAnsiTheme : {}),
    background: backgroundColor, foreground, cursor,
    cursorAccent: followsTheme ? backgroundColor : background.color,
    selectionBackground: light ? 'rgba(5, 80, 174, 0.2)' : terminalTheme.selectionBackground,
    scrollbarSliderBackground: light ? 'rgba(0, 0, 0, 0.15)' : terminalTheme.scrollbarSliderBackground,
    scrollbarSliderHoverBackground: light ? 'rgba(0, 0, 0, 0.25)' : terminalTheme.scrollbarSliderHoverBackground,
    scrollbarSliderActiveBackground: light ? 'rgba(0, 0, 0, 0.30)' : terminalTheme.scrollbarSliderActiveBackground,
  };
}

/** Updating the theme repaints the existing terminal without restarting its PTY. */
export function watchTerminalBackground(terminal: Terminal, id: string): () => void {
  const repaint = () => {
    terminal.options.theme = panelTerminalTheme(id);
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  };
  const stopBackground = useAppearanceStore.subscribe((state, previous) => {
    if ((state.panels[id] ?? state.global) !== (previous.panels[id] ?? previous.global)) repaint();
  });
  const stopTheme = useSettingsStore.subscribe((state, previous) => {
    if (state.settings.theme !== previous.settings.theme) repaint();
  });
  return () => { stopBackground(); stopTheme(); };
}
