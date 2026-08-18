import { useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLlmChatStore } from '../store/llmChatStore';
import { useInstanceStore } from '../store/instanceStore';
import { LLM_PROVIDERS } from '../types/llmProviders';
import type { LlmProvider } from '../types/instance';

/**
 * Rebuild the Rust-side LLM session for a restored panel from its saved
 * llmConfig, fetching the API key from the keyring when the provider needs
 * one. Returns false when there is nothing to rebuild from.
 */
async function recreateLlmSession(instanceId: string): Promise<boolean> {
  const inst = useInstanceStore.getState().instances.get(instanceId);
  const cfg = inst?.config.llmConfig;
  if (!cfg) return false;
  const meta = LLM_PROVIDERS[cfg.provider as Exclude<LlmProvider, 'claude'>];
  if (!meta) return false;

  let apiKey: string | null = null;
  if (meta.requiresApiKey) {
    try {
      apiKey = await invoke<string | null>('llm_get_api_key', { provider: cfg.provider });
    } catch {
      apiKey = null;
    }
    if (!apiKey) return false; // key gone from the keyring — send will fail with a clear error
  }

  try {
    await invoke('llm_create_session', {
      id: instanceId,
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl || meta.defaultBaseUrl,
      apiKey,
      systemPrompt: cfg.systemPrompt || '',
      temperature: cfg.provider === 'anthropic' ? null : cfg.temperature ?? null,
    });
    return true;
  } catch (err) {
    console.error('[useLlmChat] session recreation failed:', err);
    return false;
  }
}


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

      const payload = { id: instanceId, messagesJson: JSON.stringify(messages) };
      try {
        await invoke('llm_send_message', payload);
      } catch (err) {
        // Backend sessions live in memory and die with the app; a restored
        // panel has the config but no session. Rebuild it once and retry —
        // before this, every LLM panel was permanently dead after a restart.
        if (String(err).includes('Session not found') && (await recreateLlmSession(instanceId))) {
          try {
            await invoke('llm_send_message', payload);
            return;
          } catch (err2) {
            store.getState().setError(instanceId, String(err2));
            return;
          }
        }
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
