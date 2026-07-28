import { create } from 'zustand';
import { StreamAccumulator } from '../lib/streamAccumulator';
import type {
  StreamEvent,
  StreamAssistantMessage,
  StreamPermissionRequest,
  StreamSystemEvent,
  StreamResult,
  ChatMessage,
  AccumulatedUserMessage,
} from '../types/stream';

const MAX_MESSAGES = 10000;

interface ChatSession {
  messages: ChatMessage[];
  isStreaming: boolean;
  permissionRequest: StreamPermissionRequest | null;
  systemInfo: StreamSystemEvent | null;
  result: StreamResult | null;
  error: string | null;
  /** Non-fatal CLI stderr chatter (MCP notices, deprecation warnings, …) */
  cliWarnings: string[];
  accumulator: StreamAccumulator;
}

interface ChatState {
  sessions: Map<string, ChatSession>;
  initSession: (instanceId: string) => void;
  processEvent: (instanceId: string, event: StreamEvent) => void;
  addUserMessage: (instanceId: string, text: string) => void;
  clearError: (instanceId: string) => void;
  pushCliWarning: (instanceId: string, warning: string) => void;
  clearPermission: (instanceId: string) => void;
  setStreaming: (instanceId: string, streaming: boolean) => void;
  reset: (instanceId: string) => void;
  destroySession: (instanceId: string) => void;
  getSession: (instanceId: string) => ChatSession | undefined;
}

function createSession(): ChatSession {
  return {
    messages: [],
    isStreaming: false,
    permissionRequest: null,
    systemInfo: null,
    result: null,
    error: null,
    cliWarnings: [],
    accumulator: new StreamAccumulator(),
  };
}

function ensureSession(sessions: Map<string, ChatSession>, id: string): ChatSession {
  let session = sessions.get(id);
  if (!session) {
    session = createSession();
    sessions.set(id, session);
  }
  return session;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: new Map(),

  initSession: (instanceId) => {
    set((state) => {
      const next = new Map(state.sessions);
      const existing = next.get(instanceId);
      if (existing) {
        // Reset existing session
        existing.accumulator.reset();
        next.set(instanceId, {
          ...createSession(),
          accumulator: existing.accumulator,
        });
      } else {
        next.set(instanceId, createSession());
      }
      return { sessions: next };
    });
  },

  processEvent: (instanceId, event) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = ensureSession(next, instanceId);

      switch (event.type) {
        case 'system':
          session.systemInfo = event;
          if (event.subtype === 'error' && event.error) {
            session.error = event.error;
          }
          break;

        case 'permission':
          session.permissionRequest = event;
          break;

        case 'result': {
          session.result = event;
          session.isStreaming = false;
          const failed = event.is_error || event.subtype !== 'success';
          if (failed) {
            // Surface failed turns visibly (API errors, max turns, budget…)
            const label =
              event.subtype === 'error_max_turns' ? 'Turn aborted: maximum turns reached'
              : event.subtype === 'error_during_execution' ? 'Turn failed during execution'
              : 'Turn failed';
            const detail = event.result && event.result.trim() ? `\n${event.result.trim()}` : '';
            session.accumulator.addSystemNote('error', `${label}${detail}`);
          } else if (event.result && event.result.trim()) {
            // Commands like /compact reply only via the result event. Skip when
            // the turn already streamed an assistant reply — result then just
            // repeats the final text.
            const all = session.accumulator.getAllMessages();
            const lastMsg = all[all.length - 1];
            if (!lastMsg || !('blocks' in lastMsg)) {
              session.accumulator.addLocalAssistantMessage(event.result);
            }
          }
          session.messages = rebuildMessages(session);
          break;
        }

        case 'user': {
          // Tool results arrive as user-role events carrying tool_result blocks.
          // Events with a parent_tool_use_id belong to subagents — skip those.
          if (event.parent_tool_use_id) break;
          const content = event.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                session.accumulator.setToolResult(
                  block.tool_use_id,
                  normalizeToolResultContent(block.content),
                  block.is_error,
                );
              }
            }
            session.messages = rebuildMessages(session);
          }
          break;
        }

        case 'error':
          session.error = event.error.message;
          session.isStreaming = false;
          break;

        case 'assistant':
          // Claude CLI sends complete assistant messages (not granular streaming events)
          session.accumulator.addCompleteMessage(event as StreamAssistantMessage);
          session.messages = rebuildMessages(session);
          // Clear streaming when we get a complete assistant message with end_turn
          if ((event as StreamAssistantMessage).message?.stop_reason === 'end_turn') {
            session.isStreaming = false;
          }
          break;

        case 'message_start':
          session.isStreaming = true;
          session.accumulator.processEvent(event);
          session.messages = rebuildMessages(session);
          break;

        case 'message_stop':
          session.accumulator.processEvent(event);
          session.messages = rebuildMessages(session);
          // If the accumulator has no active streaming message, clear session streaming
          if (!session.accumulator.getCurrentMessage()) {
            session.isStreaming = false;
          }
          break;

        default:
          session.accumulator.processEvent(event);
          session.messages = rebuildMessages(session);
          break;
      }

      next.set(instanceId, { ...session });
      return { sessions: next };
    });
  },

  addUserMessage: (instanceId, text) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = ensureSession(next, instanceId);

      const userMsg: AccumulatedUserMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        timestamp: Date.now(),
      };

      session.accumulator.addUserMessage(userMsg);
      session.messages = rebuildMessages(session);
      next.set(instanceId, { ...session });
      return { sessions: next };
    });
  },

  clearError: (instanceId) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(instanceId);
      if (session) {
        next.set(instanceId, { ...session, error: null });
      }
      return { sessions: next };
    });
  },

  pushCliWarning: (instanceId, warning) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = ensureSession(next, instanceId);
      const warnings = [...session.cliWarnings, warning].slice(-20);
      next.set(instanceId, { ...session, cliWarnings: warnings });
      return { sessions: next };
    });
  },

  clearPermission: (instanceId) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(instanceId);
      if (session) {
        next.set(instanceId, { ...session, permissionRequest: null });
      }
      return { sessions: next };
    });
  },

  setStreaming: (instanceId, streaming) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(instanceId);
      if (session) {
        next.set(instanceId, { ...session, isStreaming: streaming });
      }
      return { sessions: next };
    });
  },

  reset: (instanceId) => {
    set((state) => {
      const next = new Map(state.sessions);
      const session = next.get(instanceId);
      if (session) {
        session.accumulator.reset();
        next.set(instanceId, {
          ...createSession(),
          accumulator: session.accumulator,
        });
      }
      return { sessions: next };
    });
  },

  destroySession: (instanceId) => {
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(instanceId);
      return { sessions: next };
    });
  },

  getSession: (instanceId) => {
    return get().sessions.get(instanceId);
  },
}));

/** Rebuild the unified message list from accumulator state */
function rebuildMessages(session: ChatSession): ChatMessage[] {
  const messages = session.accumulator.getAllMessages();
  if (!session.isStreaming && messages.length > MAX_MESSAGES) {
    return messages.slice(messages.length - MAX_MESSAGES);
  }
  return messages;
}

/** Tool result content can be a plain string or an array of content blocks */
function normalizeToolResultContent(
  content: string | Array<{ type: string; text?: string }> | undefined,
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c.type === 'text' ? (c.text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
