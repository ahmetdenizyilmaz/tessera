import type { ITheme, Terminal } from '@xterm/xterm';
import { getPanelBackground, useAppearanceStore } from '../store/appearanceStore';
import { backgroundForeground } from './panelBackground';

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

export function panelTerminalTheme(id: string): ITheme {
  const background = getPanelBackground(id);
  return background.mode === 'theme' ? terminalTheme : {
    ...terminalTheme, background: '#00000000', foreground: backgroundForeground(background),
  };
}

/** Updating the theme repaints the existing terminal without restarting its PTY. */
export function watchTerminalBackground(terminal: Terminal, id: string): () => void {
  return useAppearanceStore.subscribe((state, previous) => {
    if ((state.panels[id] ?? state.global) === (previous.panels[id] ?? previous.global)) return;
    terminal.options.theme = panelTerminalTheme(id);
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  });
}
