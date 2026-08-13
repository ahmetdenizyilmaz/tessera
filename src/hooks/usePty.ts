import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useInstanceStore } from '../store/instanceStore';

type PtyState = 'spawning' | 'running' | 'killing';

// Module-level Map prevents double-spawn across re-renders and strict mode double-mount
const spawnedPtys = new Map<string, PtyState>();

// Track exit listener cleanup functions
const exitListeners = new Map<string, () => void>();

// Per-instance write chains: Tauri dispatches async commands onto a
// multi-threaded runtime, so independent invokes have no ordering guarantee —
// chaining serializes keystrokes.
const writeChains = new Map<string, Promise<void>>();

function registerExitListener(id: string) {
  // Avoid duplicate listeners
  if (exitListeners.has(id)) return;

  let unlistenFn: (() => void) | null = null;
  let cancelled = false;

  listen<void>(`pty-exit-${id}`, () => {
    // PTY died — auto-clean the tracking state
    spawnedPtys.delete(id);
    // Reflect the death in the instance status so the UI stops showing a
    // green "Running" badge (and usage polling stops)
    const inst = useInstanceStore.getState().instances.get(id);
    if (inst && (inst.status === 'running' || inst.status === 'starting')) {
      useInstanceStore.getState().setStatus(id, 'stopped');
    }
    // Clean up this listener
    const cleanup = exitListeners.get(id);
    exitListeners.delete(id);
    if (cleanup) cleanup();
  }).then((fn) => {
    if (cancelled) {
      fn();
    } else {
      unlistenFn = fn;
    }
  });

  exitListeners.set(id, () => {
    cancelled = true;
    unlistenFn?.();
  });
}

export function usePty(instanceId: string) {
  const spawn = async (cols: number, rows: number) => {
    const currentState = spawnedPtys.get(instanceId);
    if (currentState === 'spawning' || currentState === 'running') return;
    // Allow re-spawn if state is 'killing' (React strict mode unmount/remount race)
    spawnedPtys.set(instanceId, 'spawning');

    const instance = useInstanceStore.getState().getInstance(instanceId);
    if (!instance) {
      spawnedPtys.delete(instanceId);
      return;
    }

    // Register one-time exit listener to auto-clean on PTY death
    registerExitListener(instanceId);

    // Pin the session id before the CLI starts. Rust resumes it if the JSONL
    // exists and passes --session-id otherwise, so this panel owns a known
    // conversation from the first keystroke. Previously the id was left to the
    // CLI and recovered afterwards by picking the newest session in the same
    // directory — which adopted an unrelated conversation whenever two panels
    // shared a folder, or one had been used by Claude Code outside the app.
    let sessionId = instance.claudeSessionId;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      useInstanceStore.getState().setClaudeSessionId(instanceId, sessionId);
    }

    try {
      await invoke('pty_spawn', {
        id: instanceId,
        cwd: instance.config.cwd,
        cols,
        rows,
        model: instance.config.model || null,
        dangerouslySkipPermissions: instance.config.dangerouslySkipPermissions,
        claudeSessionId: sessionId,
        permissionMode: instance.config.permissionMode || null,
        allowedTools: instance.config.allowedTools.length > 0 ? instance.config.allowedTools : null,
        systemPrompt: instance.config.systemPrompt || null,
      });
      spawnedPtys.set(instanceId, 'running');
    } catch (err) {
      console.error(`Failed to spawn PTY for ${instanceId}:`, err);
      spawnedPtys.delete(instanceId);
      // Clean up exit listener on spawn failure
      const cleanup = exitListeners.get(instanceId);
      if (cleanup) {
        cleanup();
        exitListeners.delete(instanceId);
      }
      // Propagate so callers can show the failure instead of "Running"
      throw err;
    }
  };

  const write = async (data: string) => {
    const prev = writeChains.get(instanceId) ?? Promise.resolve();
    const next = prev.then(() =>
      invoke<void>('pty_write', { id: instanceId, data }).catch((err) => {
        console.error(`Failed to write to PTY ${instanceId}:`, err);
      }),
    );
    writeChains.set(instanceId, next);
    await next;
  };

  const resize = async (cols: number, rows: number) => {
    try {
      await invoke('pty_resize', { id: instanceId, cols, rows });
    } catch (err) {
      console.error(`Failed to resize PTY ${instanceId}:`, err);
    }
  };

  const kill = async () => {
    spawnedPtys.set(instanceId, 'killing');
    try {
      await invoke('pty_kill', { id: instanceId });
    } catch (err) {
      console.error(`Failed to kill PTY ${instanceId}:`, err);
    }
    spawnedPtys.delete(instanceId);
    // Clean up exit listener
    const cleanup = exitListeners.get(instanceId);
    if (cleanup) {
      cleanup();
      exitListeners.delete(instanceId);
    }
  };

  const onData = (callback: (data: string) => void): Promise<UnlistenFn> => {
    return listen<string>(`pty-data-${instanceId}`, (event) => {
      callback(event.payload);
    });
  };

  return { spawn, write, resize, kill, onData };
}

// Export for external cleanup — also attempts pty_kill as safety net
export function cleanupPty(id: string) {
  spawnedPtys.delete(id);
  writeChains.delete(id);
  // Clean up exit listener
  const cleanup = exitListeners.get(id);
  if (cleanup) {
    cleanup();
    exitListeners.delete(id);
  }
  // Best-effort kill in case PTY is still alive
  invoke('pty_kill', { id }).catch(() => {});
}

export function isPtySpawned(id: string): boolean {
  return spawnedPtys.has(id);
}
