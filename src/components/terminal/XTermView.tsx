import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { usePty, isPtySpawned, consumeFreshMount } from '../../hooks/usePty';
import { useSettingsStore } from '../../store/settingsStore';
import { useInstanceStore } from '../../store/instanceStore';
import { usePanelLayout } from '../windows/PanelWindowContext';
import { useCodexStore } from '../../store/codexStore';
import { installTerminalCursorGuard } from '../../lib/terminalCursor';
import { installTerminalScrollGuard, type TerminalScrollState } from '../../lib/terminalScroll';
import { terminalPlatform } from '../../lib/terminalPlatform';
import { createTerminalResize } from '../../lib/terminalResize';
import { installTerminalPathLinks, localTerminalLinkHandler } from '../../lib/terminalPaths';
import { listen } from '@tauri-apps/api/event';
import { registerSharedTerminal } from '../../lib/terminalSharing';
import { panelTerminalTheme, watchTerminalBackground } from '../../lib/terminalTheme';
import { terminalPasteData } from '../../lib/terminalPaste';
import { touchPanel } from '../../lib/panelActivityClock';

// ─── Module-Level State (survives unmount/remount for group moves) ───────────

/** Serialized terminal buffer content saved before unmount */
const terminalBuffers: Map<string, string> =
  (globalThis as Record<string, unknown>).__termBuffers as Map<string, string> ??
  ((globalThis as Record<string, unknown>).__termBuffers = new Map<string, string>());
const terminalScrollStates = new Map<string, TerminalScrollState>();
const terminalSizes = new Map<string, { cols: number; rows: number }>();

// Keep one native subscription across moves. Replacing a listener per React
// mount creates a gap where the running TUI can emit an unrecoverable frame.
const outputStreams = new Map<string, { receive: (data: string) => void; ready: Promise<void>; stop: () => void }>();
function routeOutput(instanceId: string, receive: (data: string) => void): Promise<void> {
  const existing = outputStreams.get(instanceId);
  if (existing) { existing.receive = receive; return existing.ready; }
  let stopped = false;
  let unlisten: (() => void) | undefined;
  const stream = { receive, ready: Promise.resolve(), stop: () => { stopped = true; unlisten?.(); } };
  stream.ready = listen<string>(`pty-data-${instanceId}`, event => {
    if (!stopped) { if (event.payload) touchPanel(instanceId); stream.receive(event.payload); }
  }).then(fn => { if (stopped) fn(); else unlisten = fn; });
  outputStreams.set(instanceId, stream);
  return stream.ready;
}

/** Output buffered while the component is unmounted. */
type BackgroundBuffer = { chunks: string[]; bytes: number; cancel: () => void; snapshot: () => { cols: number; rows: number; data: string } };
const bgPtyBuffers: Map<string, BackgroundBuffer> =
  (globalThis as Record<string, unknown>).__bgPtyBuffers as Map<string, BackgroundBuffer> ??
  ((globalThis as Record<string, unknown>).__bgPtyBuffers = new Map());

/** Cap for output buffered while a panel is unmounted — Claude's TUI redraws
 *  can produce KB/s per instance and an hour in another view must not hold
 *  hundreds of MB of strings. On overflow the oldest chunks are dropped and a
 *  trim marker is prepended on replay. */
const BG_BUFFER_MAX_BYTES = 1024 * 1024;
const BG_TRIM_MARKER = '\r\n\x1b[2m[… output trimmed while panel was hidden …]\x1b[0m\r\n';

function startBackgroundBuffering(instanceId: string, release: () => void, snapshot: BackgroundBuffer['snapshot']) {
  if (bgPtyBuffers.has(instanceId)) { release(); return; }
  const chunks: string[] = [];
  bgPtyBuffers.set(instanceId, { chunks, bytes: 0, cancel: release, snapshot });
}

function bufferBackgroundOutput(instanceId: string, data: string) {
  const bg = bgPtyBuffers.get(instanceId);
  if (!bg) return;
  bg.chunks.push(data);
  bg.bytes += data.length;
  let trimmed = false;
  while (bg.bytes > BG_BUFFER_MAX_BYTES && bg.chunks.length > 1) {
    bg.bytes -= bg.chunks.shift()!.length;
    trimmed = true;
  }
  if (trimmed && bg.chunks[0] !== BG_TRIM_MARKER) {
    bg.chunks.unshift(BG_TRIM_MARKER);
    bg.bytes += BG_TRIM_MARKER.length;
  }
}

function consumeBackgroundBuffer(instanceId: string, preserve: boolean): string[] {
  const bg = bgPtyBuffers.get(instanceId);
  if (!bg) return [];
  let chunks = bg.chunks;
  if (preserve) {
    // The retained parser may have been resized by a LAN client while hidden.
    // Restore its current geometry and state, not an old-size buffer plus a
    // tail whose cursor coordinates belong to a different grid.
    const snapshot = bg.snapshot();
    terminalSizes.set(instanceId, { cols: snapshot.cols, rows: snapshot.rows });
    terminalBuffers.set(instanceId, snapshot.data);
    chunks = [];
  }
  bg.cancel();
  bgPtyBuffers.delete(instanceId);
  return preserve ? chunks : [];
}

/** Call on explicit panel close to clean up saved state */
export function clearTerminalState(instanceId: string) {
  outputStreams.get(instanceId)?.stop();
  outputStreams.delete(instanceId);
  terminalBuffers.delete(instanceId);
  terminalScrollStates.delete(instanceId);
  terminalSizes.delete(instanceId);
  const bg = bgPtyBuffers.get(instanceId);
  if (bg) { bg.cancel(); bgPtyBuffers.delete(instanceId); }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface XTermViewProps {
  instanceId: string;
  isVisible?: boolean;
}

export function XTermView({ instanceId, isVisible }: XTermViewProps) {
  const useLayoutStore = usePanelLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const resizeCoordinatorRef = useRef<ReturnType<typeof createTerminalResize> | null>(null);
  const reclaimLocalRef = useRef<(() => void) | null>(null);
  const retryIntervalRef = useRef<number | null>(null);
  const [platform, setPlatform] = useState<Pick<ITerminalOptions, 'windowsPty'>>();
  const [platformError, setPlatformError] = useState<string>();
  const isActive = useLayoutStore(s => !s.tabOrder.includes(instanceId) || s.focusedId === instanceId);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

  const { spawn, write, resize } = usePty(instanceId);

  useEffect(() => {
    let active = true;
    terminalPlatform().then(value => {
      if (active) setPlatform(value);
    }).catch(error => {
      if (active) setPlatformError(String(error));
    });
    return () => { active = false; };
  }, []);

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
      resizeCoordinatorRef.current?.requestFit();
    } catch {
      // Ignore fit errors
    }
  }, [fontSize, fontFamily]);

  // Re-fit terminal when becoming visible (opacity:0 → 1 doesn't trigger ResizeObserver)
  useEffect(() => {
    if (isVisible && isActive) { reclaimLocalRef.current?.(); resizeCoordinatorRef.current?.requestFit(); }
  }, [isVisible, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;
    let disposed = false;
    const container = containerRef.current;
    if (!container || !platform) return;
    const view = container.ownerDocument.defaultView ?? window;
    const requestAnimationFrame = view.requestAnimationFrame.bind(view);

    const settings = useSettingsStore.getState().settings;
    const freshMount = consumeFreshMount(instanceId);
    const bgChunks = consumeBackgroundBuffer(instanceId, !freshMount);
    if (freshMount) {
      terminalScrollStates.delete(instanceId);
      terminalSizes.delete(instanceId);
    }

    const getCwd = () => useInstanceStore.getState().instances.get(instanceId)?.config.cwd;
    const activateLink = localTerminalLinkHandler(getCwd);
    // Create Terminal
    const terminal = new Terminal({
      ...platform,
      ...terminalSizes.get(instanceId),
      theme: panelTerminalTheme(instanceId),
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      scrollback: 10000,
      linkHandler: { activate: activateLink, allowNonHttpProtocols: true },
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon(activateLink);
    const serializeAddon = new SerializeAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(serializeAddon);

    terminal.open(container);
    const unwatchBackground = watchTerminalBackground(terminal, instanceId);
    const pathLinks = installTerminalPathLinks(terminal, getCwd);
    const scrollGuard = installTerminalScrollGuard(terminal, terminalScrollStates.get(instanceId));
    const cursorGuard = installTerminalCursorGuard(terminal, () => {
      if (useInstanceStore.getState().instances.get(instanceId)?.config.agentProvider === 'codex') {
        const session = useCodexStore.getState().sessions[instanceId];
        return !!session?.busy && !session.requests.length;
      }
      // Claude terminal status is owned by its native TUI. Its interrupt hint
      // is present only during an active turn; approval/selection menus keep
      // xterm's ordinary cursor behavior.
      const buffer = terminal.buffer.active;
      for (let y = Math.max(0, terminal.rows - 12); y < terminal.rows; y++) {
        if (/esc to (?:interrupt|cancel)/i.test(buffer.getLine(buffer.baseY + y)?.translateToString(true) || '')) return true;
      }
      return false;
    }, () => {
      if (useInstanceStore.getState().instances.get(instanceId)?.config.agentProvider !== 'codex') return false;
      const session = useCodexStore.getState().sessions[instanceId];
      return !!session && !session.requests.length;
    });
    const unsubscribeCursor = useCodexStore.subscribe((state, previous) => {
      const session = state.sessions[instanceId], old = previous.sessions[instanceId];
      if (session?.busy !== old?.busy || session?.requests.length !== old?.requests.length) cursorGuard.update?.();
    });
    termRef.current = terminal;
    const resizeCoordinator = createTerminalResize(terminal, fitAddon, resize, () => mounted && activeRef.current);
    resizeCoordinator.pauseForRestore();
    resizeCoordinatorRef.current = resizeCoordinator;
    const unshare = registerSharedTerminal(instanceId, terminal, serializeAddon, resizeCoordinator);
    reclaimLocalRef.current = unshare.reclaimLocal;
    container.addEventListener('pointerdown', unshare.reclaimLocal);
    container.addEventListener('keydown', unshare.reclaimLocal);

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

    // Claude Code and Codex recognise a raw burst of input as a paste. agy does
    // not: it reads a paste only as the bracketed block it asked for, and
    // otherwise types it key by key and submits at every line break.
    const pasteText = (text: string) => {
      const antigravity = useInstanceStore.getState().instances.get(instanceId)?.config.agentProvider === 'antigravity';
      write(terminalPasteData(text, antigravity && terminal.modes.bracketedPasteMode));
    };

    const pasteClipboard = () => {
      navigator.clipboard.readText()
        .then((text) => {
          if (text && mounted) {
            scrollGuard.revealInput();
            pasteText(text);
          }
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
        scrollGuard.revealInput();
        pasteText(text);
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
    const pendingWrites: { data: string }[] = [];
    const writeOutput = (data: string) => {
      const pending = { data };
      pendingWrites.push(pending);
      terminal.write(data, () => {
        const index = pendingWrites.indexOf(pending);
        if (index >= 0) pendingWrites.splice(index, 1);
      });
    };
    if (freshMount) {
      terminalBuffers.delete(instanceId);
    } else {
      const savedBuffer = terminalBuffers.get(instanceId);
      if (savedBuffer) {
        writeOutput(savedBuffer);
        terminalBuffers.delete(instanceId);
      }
    }

    // Replay any PTY output buffered while component was unmounted
    for (const chunk of bgChunks) {
      writeOutput(chunk);
    }
    // Serialized escape sequences describe the old terminal dimensions.
    // Fitting before xterm has parsed them can leave a TUI partially redrawn.
    const restored = new Promise<void>(resolve => terminal.write('', () => {
      resizeCoordinator.finishRestore();
      resolve();
    }));

    // ─── Data listeners ────────────────────────────────────────────────

    // Terminal onData -> PTY write
    const dataDisposable = terminal.onData((data) => {
      write(data);
    });

    // The mount-local flag also rejects callbacks from a disposed view when
    // React immediately mounts a replacement for the same panel.
    const listening = routeOutput(instanceId, (data) => {
        // Keep the actual parser alive while hidden: serializing in the
        // middle of a split escape sequence loses parser state.
        if (disposed) return;
        if (!mounted) bufferBackgroundOutput(instanceId, data);
        writeOutput(data);
    });

    const startTerminal = async (cols: number, rows: number) => {
      // The initial transcript must not race the listener registration.
      await listening;
      if (!mounted) return;
      await spawn(cols, rows);
      resizeCoordinator.ready({ cols, rows });
    };

    // ─── Spawn PTY (only if not already running) ───────────────────────

    const alreadyRunning = isPtySpawned(instanceId);

    if (!alreadyRunning) {
      // Double-RAF spawn sequence
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          await restored;
          if (!mounted) return;

          try {
            resizeCoordinator.fitNow();
          } catch {
            // Ignore fit errors
          }

          const cols = terminal.cols;
          const rows = terminal.rows;

          if (cols > 0 && rows > 0) {
            startTerminal(cols, rows)
              .then(() => {
                if (mounted) {
                  useInstanceStore.getState().setStatus(instanceId, 'running');
                }
              })
              .catch((err) => {
                if (!mounted) return;
                useInstanceStore.getState().setStatus(instanceId, 'error');
                terminal.writeln(`\r\n\x1b[31mFailed to start coding agent: ${err}\x1b[0m`);
              });
          } else {
            // Retry up to 5 times at 200ms intervals
            let retries = 0;
            retryIntervalRef.current = window.setInterval(() => {
              if (!mounted) {
                if (retryIntervalRef.current !== null) {
                  clearInterval(retryIntervalRef.current);
                  retryIntervalRef.current = null;
                }
                return;
              }

              retries++;
              try {
                resizeCoordinator.fitNow();
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
                startTerminal(c, r)
                  .then(() => {
                    if (mounted) {
                      useInstanceStore.getState().setStatus(instanceId, 'running');
                    }
                  })
                  .catch((err) => {
                    if (!mounted) return;
                    useInstanceStore.getState().setStatus(instanceId, 'error');
                    terminal.writeln(`\r\n\x1b[31mFailed to start coding agent: ${err}\x1b[0m`);
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
      requestAnimationFrame(async () => {
        await restored;
        await listening;
        if (!mounted) return;
        try {
          resizeCoordinator.ready(terminalSizes.get(instanceId));
          resizeCoordinator.fitNow();
        } catch {
          // Ignore fit errors
        }
      });
    }

    const resizeObserver = new view.ResizeObserver(() => {
      if (mounted) resizeCoordinator.requestFit();
    });
    resizeObserver.observe(container);
    const repaintAfterMove = () => { if (mounted) resizeCoordinator.requestFit(); };
    const tile = container.closest('[data-panel-id]');
    tile?.addEventListener('transitionend', repaintAfterMove);
    view.addEventListener('focus', repaintAfterMove);
    view.addEventListener('resize', repaintAfterMove);

    // Cleanup — preserve PTY process for potential group-move remount
    return () => {
      mounted = false;
      if (retryIntervalRef.current !== null) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
      container.removeEventListener('pointerdown', unshare.reclaimLocal);
      container.removeEventListener('keydown', unshare.reclaimLocal);
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('paste', handleNativePaste, true);
      resizeObserver.disconnect();
      tile?.removeEventListener('transitionend', repaintAfterMove);
      view.removeEventListener('focus', repaintAfterMove);
      view.removeEventListener('resize', repaintAfterMove);

      // Save terminal buffer content before disposing. SerializeAddon
      // preserves colors/attributes and avoids the O(scrollback) manual
      // line-by-line extraction.
      try {
        terminalScrollStates.set(instanceId, scrollGuard.snapshot());
        terminalSizes.set(instanceId, { cols: terminal.cols, rows: terminal.rows });
        // xterm parses writes asynchronously. Preserve the queued tail as well
        // as the parsed screen; a move must not drop the TUI's latest repaint.
        const serialized = serializeAddon.serialize() + pendingWrites.map(p => p.data).join('');
        if (serialized.trim()) {
          terminalBuffers.set(instanceId, serialized);
        }
      } catch {
        // Serialization is best-effort — worse case the remount starts blank
      }

      // Retain the parser for hidden/stopped panels, but release closed ones.
      terminal.options.cursorBlink = false;
      const release = () => {
        disposed = true;
        resizeCoordinator.dispose();
        unshare();
        terminal.dispose();
      };

      dataDisposable.dispose();
      unsubscribeCursor();
      pathLinks.dispose();
      unwatchBackground();
      cursorGuard.dispose();
      scrollGuard.dispose();
      if (useInstanceStore.getState().instances.has(instanceId) && !useInstanceStore.getState().instances.get(instanceId)?.hibernation?.sleeping) {
        startBackgroundBuffering(instanceId, release, () => ({ cols: terminal.cols, rows: terminal.rows,
          data: serializeAddon.serialize() + pendingWrites.map(p => p.data).join('') }));
      } else {
        release();
        clearTerminalState(instanceId);
      }
      termRef.current = null;
      resizeCoordinatorRef.current = null;
      reclaimLocalRef.current = null;

      // DON'T kill PTY here — it's killed explicitly via handleClose/closePanel
    };
  }, [instanceId, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        isolation: 'isolate',
      }}
    >
      {platformError && <div role="alert">Cannot initialize terminal: {platformError}</div>}
    </div>
  );
}
