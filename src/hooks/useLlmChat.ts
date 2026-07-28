import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLlmChatStore } from '../store/llmChatStore';

interface ChunkPayload {
  content: string;
}

interface ErrorPayload {
  error: string;
}

export function useLlmChat(instanceId: string) {
  const store = useLlmChatStore;
  const conversation = store((s) => s.getConversation(instanceId));
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  // Set up event listeners
  useEffect(() => {
    let mounted = true;
    const setupListeners = async () => {
      const unlistenChunk = await listen<ChunkPayload>(
        `llm-chunk-${instanceId}`,
        (event) => {
          if (mounted && event.payload.content) {
            store.getState().appendChunk(instanceId, event.payload.content);
          }
        },
      );

      const unlistenDone = await listen<void>(
        `llm-done-${instanceId}`,
        () => {
          if (mounted) {
            store.getState().finishStreaming(instanceId);
          }
        },
      );

      const unlistenError = await listen<ErrorPayload>(
        `llm-error-${instanceId}`,
        (event) => {
          if (mounted) {
            store.getState().setError(instanceId, event.payload.error);
          }
        },
      );

      if (mounted) {
        unlistenRefs.current = [unlistenChunk, unlistenDone, unlistenError];
      } else {
        unlistenChunk();
        unlistenDone();
        unlistenError();
      }
    };

    setupListeners();

    return () => {
      mounted = false;
      for (const fn of unlistenRefs.current) fn();
      unlistenRefs.current = [];
    };
  }, [instanceId]);

  const sendMessage = useCallback(
    async (text: string) => {
      store.getState().addUserMessage(instanceId, text);
      store.getState().startStreaming(instanceId);

      // Build full message array from store
      const conv = store.getState().getConversation(instanceId);
      const messages = conv.messages
        .filter((m) => !m.isStreaming)
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        await invoke('llm_send_message', {
          id: instanceId,
          messagesJson: JSON.stringify(messages),
        });
      } catch (err) {
        store.getState().setError(instanceId, String(err));
      }
    },
    [instanceId],
  );

  const cancelStream = useCallback(async () => {
    try {
      await invoke('llm_cancel', { id: instanceId });
    } catch {
      // Session may not exist
    }
  }, [instanceId]);

  return {
    messages: conversation.messages,
    isStreaming: conversation.isStreaming,
    error: conversation.error,
    sendMessage,
    cancelStream,
  };
}
