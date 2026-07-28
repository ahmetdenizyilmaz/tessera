import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { usePty, isPtySpawned } from '../../hooks/usePty';
import { useSettingsStore } from '../../store/settingsStore';
import { useInstanceStore } from '../../store/instanceStore';
import { listen } from '@tauri-apps/api/event';

// ─── Module-Level State (survives unmount/remount for group moves) ───────────

/** Serialized terminal buffer content saved before unmount */
const terminalBuffers: Map<string, string> =
  (globalThis as Record<string, unknown>).__termBuffers as Map<string, string> ??
  ((globalThis as Record<string, unknown>).__termBuffers = new Map<string, string>());

/** Background PTY data listeners that buffer output while component is unmounted */
const bgPtyBuffers: Map<string, { chunks: string[]; cancel: () => void }> =
  (globalThis as Record<string, unknown>).__bgPtyBuffers as Map<string, { chunks: string[]; cancel: () => void }> ??
  ((globalThis as Record<string, unknown>).__bgPtyBuffers = new Map());

function startBackgroundBuffering(instanceId: string) {
  if (bgPtyBuffers.has(instanceId)) return;

  const chunks: string[] = [];
  let unlistenFn: (() => void) | null = null;
  let cancelled = false;

  listen<string>(`pty-data-${instanceId}`, (event) => {
    if (!cancelled) chunks.push(event.payload);
  }).then((fn) => {
    if (cancelled) { fn(); return; }
    unlistenFn = fn;
  });

  bgPtyBuffers.set(instanceId, {
    chunks,
    cancel: () => {
      cancelled = true;
      unlistenFn?.();
    },
  });
}

function consumeBackgroundBuffer(instanceId: string): string[] {
  const bg = bgPtyBuffers.get(instanceId);
  if (!bg) return [];
  bg.cancel();
  bgPtyBuffers.delete(instanceId);
  return bg.chunks;
}

/** Call on explicit panel close to clean up saved state */
export function clearTerminalState(instanceId: string) {
  terminalBuffers.delete(instanceId);
  const bg = bgPtyBuffers.get(instanceId);
  if (bg) { bg.cancel(); bgPtyBuffers.delete(instanceId); }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface XTermViewProps {
  instanceId: string;
  isVisible?: boolean;
}

export function XTermView({ instanceId, isVisible }: XTermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isMountedRef = useRef(true);
  const retryIntervalRef = useRef<number | null>(null);

  const { spawn, write, resize, onData } = usePty(instanceId);

  // Subscribe to settings changes for font size and font family
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const fontFamily = useSettingsStore((s) => s.settings.fontFamily);

  // Update terminal options when font settings change
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.fontFamily = fontFamily;
    try {
      fitAddonRef.current?.fit();
    } catch {
      // Ignore fit errors
    }
  }, [fontSize, fontFamily]);

  // Re-fit terminal when becoming visible (opacity:0 → 1 doesn't trigger ResizeObserver)
  useEffect(() => {
    if (isVisible && fitAddonRef.current && termRef.current) {
      try {
        fitAddonRef.current.fit();
        const c = termRef.current.cols;
        const r = termRef.current.rows;
        if (c > 0 && r > 0) {
          resize(c, r);
        }
      } catch {
        // Ignore fit errors
      }
    }
  }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    isMountedRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    const settings = useSettingsStore.getState().settings;

    // Create Terminal
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
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
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
    termRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // ─── Restore saved state from previous mount (group move) ──────────

    const savedBuffer = terminalBuffers.get(instanceId);
    if (savedBuffer) {
      terminal.write(savedBuffer);
      terminalBuffers.delete(instanceId);
    }

    // Replay any PTY output buffered while component was unmounted
    const bgChunks = consumeBackgroundBuffer(instanceId);
    for (const chunk of bgChunks) {
      terminal.write(chunk);
    }

    // ─── Data listeners ────────────────────────────────────────────────

    // Terminal onData -> PTY write
    const dataDisposable = terminal.onData((data) => {
      write(data);
    });

    // PTY event listener setup with async IIFE + isMounted guard
    let unlisten: (() => void) | null = null;
    (async () => {
      const fn = await onData((data) => {
        if (!isMountedRef.current) return;
        terminal.write(data);
      });
      if (!isMountedRef.current) {
        fn();
        return;
      }
      unlisten = fn;
    })();

    // ─── Spawn PTY (only if not already running) ───────────────────────

    const alreadyRunning = isPtySpawned(instanceId);

    if (!alreadyRunning) {
      // Double-RAF spawn sequence
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isMountedRef.current) return;

          try {
            fitAddon.fit();
          } catch {
            // Ignore fit errors
          }

          const cols = terminal.cols;
          const rows = terminal.rows;

          if (cols > 0 && rows > 0) {
            spawn(cols, rows).then(() => {
              if (isMountedRef.current) {
                useInstanceStore.getState().setStatus(instanceId, 'running');
              }
            });
          } else {
            // Retry up to 5 times at 200ms intervals
            let retries = 0;
            retryIntervalRef.current = window.setInterval(() => {
              if (!isMountedRef.current) {
                if (retryIntervalRef.current !== null) {
                  clearInterval(retryIntervalRef.current);
                  retryIntervalRef.current = null;
                }
                return;
              }

              retries++;
              try {
                fitAddon.fit();
              } catch {
                // Ignore
              }

              const c = terminal.cols;
              const r = terminal.rows;
              if (c > 0 && r > 0) {
                if (retryIntervalRef.current !== null) {
                  clearInterval(retryIntervalRef.current);
                  retryIntervalRef.current = null;
                }
                spawn(c, r).then(() => {
                  if (isMountedRef.current) {
                    useInstanceStore.getState().setStatus(instanceId, 'running');
                  }
                });
              } else if (retries >= 5) {
                if (retryIntervalRef.current !== null) {
                  clearInterval(retryIntervalRef.current);
                  retryIntervalRef.current = null;
                }
                console.error(`XTermView: Failed to get valid dimensions after 5 retries for ${instanceId}`);
              }
            }, 200);
          }
        });
      });
    } else {
      // PTY already running (remount after group move) — just fit
      requestAnimationFrame(() => {
        if (!isMountedRef.current) return;
        try {
          fitAddon.fit();
          const c = terminal.cols;
          const r = terminal.rows;
          if (c > 0 && r > 0) {
            resize(c, r);
          }
        } catch {
          // Ignore fit errors
        }
      });
    }

    // ResizeObserver -> fit + pty_resize
    const resizeObserver = new ResizeObserver(() => {
      if (!isMountedRef.current) return;
      try {
        fitAddon.fit();
        const c = terminal.cols;
        const r = terminal.rows;
        if (c > 0 && r > 0) {
          resize(c, r);
        }
      } catch {
        // Ignore resize errors
      }
    });
    resizeObserver.observe(container);

    // Cleanup — preserve PTY process for potential group-move remount
    return () => {
      isMountedRef.current = false;
      if (retryIntervalRef.current !== null) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
      resizeObserver.disconnect();

      // Save terminal buffer content before disposing
      const buf = terminal.buffer;
      const lines: string[] = [];
      for (let i = 0; i < buf.active.length; i++) {
        const line = buf.active.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      const serialized = lines.join('\r\n');
      if (serialized.trim()) {
        terminalBuffers.set(instanceId, serialized);
      }

      // Start background PTY buffering if PTY is still alive
      if (isPtySpawned(instanceId)) {
        startBackgroundBuffering(instanceId);
      }

      dataDisposable.dispose();
      if (unlisten) unlisten();
      terminal.dispose();
      termRef.current = null;
      fitAddonRef.current = null;

      // DON'T kill PTY here — it's killed explicitly via handleClose/closePanel
    };
  }, [instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
}
