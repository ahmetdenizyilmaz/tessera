import { useCallback, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
}

// Module-level map: persists across re-renders
const terminalMap = new Map<string, TerminalEntry>();

export function useTerminal() {
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const createTerminal = useCallback((id: string, container: HTMLDivElement): TerminalEntry => {
    // Destroy existing if present
    if (terminalMap.has(id)) {
      destroyTerminal(id);
    }

    const terminal = new Terminal({
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#4a9eff',
        selectionBackground: 'rgba(74, 158, 255, 0.3)',
        black: '#2d2d2d',
        brightBlack: '#555555',
        red: '#ff6b6b',
        brightRed: '#ff8787',
        green: '#51cf66',
        brightGreen: '#69db7c',
        yellow: '#ffd43b',
        brightYellow: '#ffe066',
        blue: '#4a9eff',
        brightBlue: '#74b9ff',
        magenta: '#cc5de8',
        brightMagenta: '#da77f2',
        cyan: '#20c997',
        brightCyan: '#38d9a9',
        white: '#e0e0e0',
        brightWhite: '#ffffff',
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);
    containerRefs.current.set(id, container);

    const entry: TerminalEntry = { terminal, fitAddon, searchAddon };
    terminalMap.set(id, entry);

    return entry;
  }, []);

  const getTerminal = useCallback((id: string): TerminalEntry | undefined => {
    return terminalMap.get(id);
  }, []);

  const fitTerminal = useCallback((id: string) => {
    const entry = terminalMap.get(id);
    if (entry) {
      try {
        entry.fitAddon.fit();
      } catch {
        // Ignore fit errors (container not visible)
      }
    }
  }, []);

  return { createTerminal, getTerminal, fitTerminal };
}

export function destroyTerminal(id: string) {
  const entry = terminalMap.get(id);
  if (entry) {
    entry.terminal.dispose();
    terminalMap.delete(id);
  }
}

export function getTerminalEntry(id: string): TerminalEntry | undefined {
  return terminalMap.get(id);
}
