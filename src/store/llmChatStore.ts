import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LlmChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ConversationState {
  messages: LlmChatMessage[];
  isStreaming: boolean;
  error: string | null;
}

interface LlmChatState {
  conversations: Record<string, ConversationState>;

  getConversation: (id: string) => ConversationState;
  addUserMessage: (id: string, content: string) => void;
  startStreaming: (id: string) => void;
  appendChunk: (id: string, content: string) => void;
  finishStreaming: (id: string) => void;
  setError: (id: string, error: string) => void;
  clearConversation: (id: string) => void;
  removeConversation: (id: string) => void;
  /** Re-key conversations old id → new id after a workspace restore, and drop
   *  any conversation whose id no longer belongs to a live panel. */
  remapConversations: (idMap: Map<string, string>, liveIds: Set<string>) => void;
}

const EMPTY_CONVERSATION: ConversationState = {
  messages: [],
  isStreaming: false,
  error: null,
};

export const useLlmChatStore = create<LlmChatState>()(
  persist(
    (set, get) => ({
      conversations: {},

      getConversation: (id: string) => {
        return get().conversations[id] ?? EMPTY_CONVERSATION;
      },

      addUserMessage: (id: string, content: string) => {
        set((state) => {
          const conv = state.conversations[id] ?? { ...EMPTY_CONVERSATION };
          return {
            conversations: {
              ...state.conversations,
              [id]: {
                ...conv,
                error: null,
                messages: [
                  ...conv.messages,
                  {
                    id: crypto.randomUUID(),
                    role: 'user' as const,
                    content,
                    timestamp: Date.now(),
                  },
                ],
              },
            },
          };
        });
      },

      startStreaming: (id: string) => {
        set((state) => {
          const conv = state.conversations[id] ?? { ...EMPTY_CONVERSATION };
          return {
            conversations: {
              ...state.conversations,
              [id]: {
                ...conv,
                isStreaming: true,
                error: null,
                messages: [
                  ...conv.messages,
                  {
                    id: crypto.randomUUID(),
                    role: 'assistant' as const,
                    content: '',
                    timestamp: Date.now(),
                    isStreaming: true,
                  },
                ],
              },
            },
          };
        });
      },

      appendChunk: (id: string, content: string) => {
        set((state) => {
          const conv = state.conversations[id];
          if (!conv || conv.messages.length === 0) return state;

          const messages = [...conv.messages];
          const last = messages[messages.length - 1];
          if (last.role === 'assistant' && last.isStreaming) {
            messages[messages.length - 1] = {
              ...last,
              content: last.content + content,
            };
          }

          return {
            conversations: {
              ...state.conversations,
              [id]: { ...conv, messages },
            },
          };
        });
      },

      finishStreaming: (id: string) => {
        set((state) => {
          const conv = state.conversations[id];
          if (!conv) return state;

          const messages = conv.messages.map((msg) =>
            msg.isStreaming ? { ...msg, isStreaming: false } : msg,
          );

          return {
            conversations: {
              ...state.conversations,
              [id]: { ...conv, isStreaming: false, messages },
            },
          };
        });
      },

      setError: (id: string, error: string) => {
        set((state) => {
          const conv = state.conversations[id] ?? { ...EMPTY_CONVERSATION };
          // If there's a streaming message, finish it and mark error
          const messages = conv.messages.map((msg) =>
            msg.isStreaming ? { ...msg, isStreaming: false } : msg,
          );

          return {
            conversations: {
              ...state.conversations,
              [id]: { ...conv, isStreaming: false, error, messages },
            },
          };
        });
      },

      clearConversation: (id: string) => {
        set((state) => ({
          conversations: {
            ...state.conversations,
            [id]: { ...EMPTY_CONVERSATION },
          },
        }));
      },

      remapConversations: (idMap, liveIds) => {
        set((state) => {
          const next: Record<string, ConversationState> = {};
          for (const [oldId, conv] of Object.entries(state.conversations)) {
            const newId = idMap.get(oldId) ?? oldId;
            if (liveIds.has(newId)) next[newId] = conv;
          }
          return { conversations: next };
        });
      },

      removeConversation: (id: string) => {
        set((state) => {
          const { [id]: _, ...rest } = state.conversations;
          return { conversations: rest };
        });
      },
    }),
    {
      name: 'tessera-llm-chats',
      partialize: (state) => ({
        // Only persist conversations (not streaming state)
        conversations: Object.fromEntries(
          Object.entries(state.conversations).map(([id, conv]) => [
            id,
            {
              messages: conv.messages.map((msg) => ({ ...msg, isStreaming: false })),
              isStreaming: false,
              error: null,
            },
          ]),
        ),
      }),
    },
  ),
);
