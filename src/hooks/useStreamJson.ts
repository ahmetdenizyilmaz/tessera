import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '../store/chatStore';
import type {
  ChatMessage,
  StreamPermissionRequest,
  StreamResult,
  StreamSystemEvent,
} from '../types/stream';

interface SpawnOptions {
  model?: string;
  systemPrompt?: string;
  sessionId?: string;
  mcpConfigPath?: string;
  permissionMode?: string;
  allowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
}

interface UseStreamJsonReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  permissionRequest: StreamPermissionRequest | null;
  systemInfo: StreamSystemEvent | null;
  result: StreamResult | null;
  error: string | null;
  spawn: (cwd: string, options?: SpawnOptions) => Promise<void>;
  send: (message: string) => Promise<void>;
  respondPermission: (allow: boolean) => Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * Hook for the stream-JSON chat pipeline.
 *
 * Data delivery: Rust pushes NDJSON lines into the webview via eval(),
 * calling window.__streamPush() which is registered by streamBridge.ts.
 * No Tauri listen() needed — the bridge writes directly into chatStore.
 */
export function useStreamJson(instanceId: string): UseStreamJsonReturn {
  const session = useChatStore((s) => s.sessions.get(instanceId));
  const initSession = useChatStore((s) => s.initSession);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const clearPermission = useChatStore((s) => s.clearPermission);
  const clearError = useChatStore((s) => s.clearError);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const sendingRef = useRef(false);

  const spawn = useCallback(async (cwd: string, options?: SpawnOptions) => {
    initSession(instanceId);

    await invoke('stream_spawn', {
      id: instanceId,
      cwd,
      model: options?.model || null,
      systemPrompt: options?.systemPrompt || null,
      sessionId: options?.sessionId || null,
      mcpConfigPath: options?.mcpConfigPath || null,
      permissionMode: options?.permissionMode || null,
      allowedTools: options?.allowedTools && options.allowedTools.length > 0 ? options.allowedTools : null,
      dangerouslySkipPermissions: options?.dangerouslySkipPermissions ?? false,
    });
  }, [instanceId, initSession]);

  const send = useCallback(async (message: string) => {
    if (sendingRef.current) {
      console.warn(`[useStreamJson:${instanceId}] send already in progress, ignoring`);
      return;
    }
    sendingRef.current = true;
    addUserMessage(instanceId, message);
    setStreaming(instanceId, true);
    clearPermission(instanceId);
    clearError(instanceId);
    try {
      await invoke('stream_send_message', { id: instanceId, message });
    } catch (err) {
      console.error(`[useStreamJson:${instanceId}] send failed:`, err);
      useChatStore.setState((state) => {
        const next = new Map(state.sessions);
        const s = next.get(instanceId);
        if (s) {
          next.set(instanceId, { ...s, error: String(err), isStreaming: false });
        }
        return { sessions: next };
      });
    } finally {
      sendingRef.current = false;
    }
  }, [instanceId, addUserMessage, setStreaming, clearPermission, clearError]);

  const respondPermission = useCallback(async (allow: boolean) => {
    clearPermission(instanceId);
    await invoke('stream_respond_permission', { id: instanceId, allowed: allow });
  }, [instanceId, clearPermission]);

  const cancel = useCallback(async () => {
    setStreaming(instanceId, false);
    await invoke('stream_kill', { id: instanceId });
  }, [instanceId, setStreaming]);

  return {
    messages: session?.messages ?? [],
    isStreaming: session?.isStreaming ?? false,
    permissionRequest: session?.permissionRequest ?? null,
    systemInfo: session?.systemInfo ?? null,
    result: session?.result ?? null,
    error: session?.error ?? null,
    spawn,
    send,
    respondPermission,
    cancel,
  };
}
