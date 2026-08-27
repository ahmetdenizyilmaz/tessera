import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { usePty, isPtySpawned, consumeFreshMount } from '../../hooks/usePty';
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

/** Cap for output buffered while a panel is unmounted — Claude's TUI redraws
 *  can produce KB/s per instance and an hour in another view must not hold
 *  hundreds of MB of strings. On overflow the oldest chunks are dropped and a
 *  trim marker is prepended on replay. */
const BG_BUFFER_MAX_BYTES = 1024 * 1024;
const BG_TRIM_MARKER = '\r\n\x1b[2m[… output trimmed while panel was hidden …]\x1b[0m\r\n';

function startBackgroundBuffering(instanceId: string) {
  if (bgPtyBuffers.has(instanceId)) return;

  const chunks: string[] = [];
  let totalBytes = 0;
  let trimmed = false;
  let unlistenFn: (() => void) | null = null;
  let cancelled = false;

  listen<string>(`pty-data-${instanceId}`, (event) => {
    if (cancelled) return;
    chunks.push(event.payload);
    totalBytes += event.payload.length;
    while (totalBytes > BG_BUFFER_MAX_BYTES && chunks.length > 1) {
      totalBytes -= chunks[0].length;
      chunks.shift();
      trimmed = true;
    }
    if (trimmed && chunks[0] !== BG_TRIM_MARKER) {
      chunks.unshift(BG_TRIM_MARKER);
      totalBytes += BG_TRIM_MARKER.length;
    }
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
    const serializeAddon = new SerializeAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(serializeAddon);

    terminal.open(container);
    termRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // ─── Clipboard ─────────────────────────────────────────────────────
    // xterm sends every keystroke to the PTY, so copy/paste needs explicit
    // handling. Windows Terminal semantics: Ctrl+C copies when there IS a
    // selection and otherwise still interrupts the CLI.

    const copySelection = (): boolean => {
      const sel = terminal.getSelection();
      if (!sel) return false;
      navigator.clipboard.writeText(sel).catch((err) => {
        console.error('Copy failed:', err);
      });
      terminal.clearSelection();
      return true;
    };

    const pasteClipboard = () => {
      navigator.clipboard.readText()
        .then((text) => {
          if (text) write(text);
        })
        .catch((err) => console.error('Paste failed:', err));
    };

    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const key = e.key.toLowerCase();

      // Ctrl+Tab belongs to the app (panel switching), not the shell. Returning
      // false keeps xterm from writing it to the PTY; the event still bubbles
      // to the document handler in App.tsx.
      if (e.ctrlKey && key === 'tab') {
        return false;
      }

      if (e.ctrlKey && e.shiftKey && key === 'c') {
        copySelection();
        return false;
      }
      // Plain Ctrl+C: copy if something is selected, else let it interrupt
      if (e.ctrlKey && !e.shiftKey && key === 'c') {
        return !copySelection();
      }
      if (e.ctrlKey && e.shiftKey && key === 'a') {
        terminal.selectAll();
        return false;
      }
      // Paste: we do it ourselves AND preventDefault, so the webview cannot
      // also deliver a native paste event to xterm's textarea. Handling it
      // without preventDefault pasted twice; leaving it entirely to the
      // native path pasted not at all in WebView2.
      if ((e.ctrlKey && key === 'v') || (e.shiftKey && e.key === 'Insert')) {
        e.preventDefault();
        pasteClipboard();
        return false;
      }
      return true;
    });

    // Belt and braces: if a native paste event still reaches the terminal
    // (context-menu paste, IME quirks), let it through exactly once and
    // never in addition to the handler above.
    const handleNativePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text');
      if (text) {
        e.preventDefault();
        e.stopPropagation();
        write(text);
      }
    };
    container.addEventListener('paste', handleNativePaste, true);

    // Right-click: copy a selection if there is one, otherwise paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (!copySelection()) pasteClipboard();
    };
    container.addEventListener('contextmenu', handleContextMenu);

    // ─── Restore saved state from previous mount (group move) ──────────

    // A restart/fresh-start marks this id so we DON'T replay the previous
    // conversation's scrollback (the old view's unmount re-saved it after
    // restartPty ran). Clear it and start clean.
    if (consumeFreshMount(instanceId)) {
      terminalBuffers.delete(instanceId);
    } else {
      const savedBuffer = terminalBuffers.get(instanceId);
      if (savedBuffer) {
        terminal.write(savedBuffer);
        terminalBuffers.delete(instanceId);
      }
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
            spawn(cols, rows)
              .then(() => {
                if (isMountedRef.current) {
                  useInstanceStore.getState().setStatus(instanceId, 'running');
                }
              })
              .catch((err) => {
                useInstanceStore.getState().setStatus(instanceId, 'error');
                terminal.writeln(`\r\n\x1b[31mFailed to start claude: ${err}\x1b[0m`);
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
                spawn(c, r)
                  .then(() => {
                    if (isMountedRef.current) {
                      useInstanceStore.getState().setStatus(instanceId, 'running');
                    }
                  })
                  .catch((err) => {
                    useInstanceStore.getState().setStatus(instanceId, 'error');
                    terminal.writeln(`\r\n\x1b[31mFailed to start claude: ${err}\x1b[0m`);
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

    // ResizeObserver -> fit immediately (visual feel). The pty_resize IPC is
    // leading + trailing debounced: a DISCRETE jump (focus change — the
    // content wrapper snaps to final size in one step) reaches ConPTY at
    // once, so the CLI redraws its TUI during the tile animation instead of
    // after it. Rapid sequences (gutter drags fire the observer every
    // pointer-move frame) still coalesce on the 100ms trailing edge — each
    // ConPTY resize makes the CLI redraw its whole TUI, feeding back into
    // the output event storm.
    let resizeDebounce: number | null = null;
    let lastPtyResize = 0;
    const sendPtyResize = () => {
      const c = terminal.cols;
      const r = terminal.rows;
      if (c > 0 && r > 0) {
        lastPtyResize = Date.now();
        resize(c, r);
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      if (!isMountedRef.current) return;
      try {
        fitAddon.fit();
      } catch {
        // Ignore fit errors
      }
      if (resizeDebounce === null && Date.now() - lastPtyResize > 150) {
        sendPtyResize();
        return;
      }
      if (resizeDebounce !== null) clearTimeout(resizeDebounce);
      resizeDebounce = window.setTimeout(() => {
        resizeDebounce = null;
        if (!isMountedRef.current) return;
        sendPtyResize();
      }, 100);
    });
    resizeObserver.observe(container);

    // Cleanup — preserve PTY process for potential group-move remount
    return () => {
      isMountedRef.current = false;
      if (retryIntervalRef.current !== null) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
      if (resizeDebounce !== null) {
        clearTimeout(resizeDebounce);
        resizeDebounce = null;
      }
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('paste', handleNativePaste, true);
      resizeObserver.disconnect();

      // Save terminal buffer content before disposing. SerializeAddon
      // preserves colors/attributes and avoids the O(scrollback) manual
      // line-by-line extraction.
      try {
        const serialized = serializeAddon.serialize();
        if (serialized.trim()) {
          terminalBuffers.set(instanceId, serialized);
        }
      } catch {
        // Serialization is best-effort — worse case the remount starts blank
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
