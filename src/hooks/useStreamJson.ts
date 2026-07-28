import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useChatStore } from '../store/chatStore';
import type {
  ChatMessage,
  StreamPermissionRequest,
  StreamResult,
  StreamSystemEvent,
  PendingControlRequest,
  ControlResponsePayload,
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
  controlRequests: PendingControlRequest[];
  systemInfo: StreamSystemEvent | null;
  result: StreamResult | null;
  error: string | null;
  /** Register/refresh the instance config on the Rust side (idempotent —
   *  the process itself spawns lazily on the first send). */
  spawn: (cwd: string, options?: SpawnOptions) => Promise<void>;
  send: (message: string, images?: string[]) => Promise<void>;
  /** Answer a pending control request (permission / AskUserQuestion / plan) */
  respondControl: (requestId: string, response: ControlResponsePayload) => Promise<void>;
  /** Abort the current turn — the process survives and stays resumable */
  interrupt: () => Promise<void>;
  /** Stop button: alias for interrupt */
  cancel: () => Promise<void>;
}

/**
 * Hook for the persistent stream-JSON chat pipeline.
 *
 * Data delivery: Rust pushes NDJSON line batches into the webview via eval(),
 * calling window.__streamPushBatch() which is registered by streamBridge.ts.
 */
export function useStreamJson(instanceId: string): UseStreamJsonReturn {
  const session = useChatStore((s) => s.sessions.get(instanceId));
  const initSession = useChatStore((s) => s.initSession);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const clearError = useChatStore((s) => s.clearError);
  const removeControlRequest = useChatStore((s) => s.removeControlRequest);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const sendingRef = useRef(false);

  const spawn = useCallback(async (cwd: string, options?: SpawnOptions) => {
    // Only initialize the UI session if none exists — stream_configure is
    // called on every mount and must not wipe an existing transcript.
    if (!useChatStore.getState().sessions.get(instanceId)) {
      initSession(instanceId);
    }

    await invoke('stream_configure', {
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

  const send = useCallback(async (message: string, images?: string[]) => {
    if (sendingRef.current) {
      console.warn(`[useStreamJson:${instanceId}] send already in progress, ignoring`);
      return;
    }
    sendingRef.current = true;
    addUserMessage(instanceId, message, images);
    setStreaming(instanceId, true);
    clearError(instanceId);
    try {
      await invoke('stream_send_message', {
        id: instanceId,
        message,
        images: images && images.length > 0 ? images : null,
      });
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
  }, [instanceId, addUserMessage, setStreaming, clearError]);

  const respondControl = useCallback(async (requestId: string, response: ControlResponsePayload) => {
    removeControlRequest(instanceId, requestId);
    await invoke('stream_control_response', {
      id: instanceId,
      requestId,
      response,
    });
  }, [instanceId, removeControlRequest]);

  const interrupt = useCallback(async () => {
    try {
      await invoke('stream_control_request', {
        id: instanceId,
        subtype: 'interrupt',
        payload: null,
      });
    } catch (err) {
      console.warn(`[useStreamJson:${instanceId}] interrupt failed:`, err);
      // Process may already be gone — clear the spinner either way
      setStreaming(instanceId, false);
    }
  }, [instanceId, setStreaming]);

  return {
    messages: session?.messages ?? [],
    isStreaming: session?.isStreaming ?? false,
    permissionRequest: session?.permissionRequest ?? null,
    controlRequests: session?.controlRequests ?? [],
    systemInfo: session?.systemInfo ?? null,
    result: session?.result ?? null,
    error: session?.error ?? null,
    spawn,
    send,
    respondControl,
    interrupt,
    cancel: interrupt,
  };
}
