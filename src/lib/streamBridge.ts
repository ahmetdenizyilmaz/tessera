/**
 * Stream bridge: Global callbacks injected by Rust via WebviewWindow::eval().
 *
 * Tauri v2's emit()/listen() event system doesn't deliver events to the
 * WebView2 webview. As a workaround, the Rust backend calls eval() to
 * invoke these global functions directly, pushing NDJSON lines into the
 * React state via chatStore.
 *
 * Also wires the event bus so plugins can send messages to chat instances
 * and receive assistant responses.
 */
import { invoke } from '@tauri-apps/api/core';
import { parseLine } from './streamJsonParser';
import { useChatStore } from '../store/chatStore';
import { useEventBusStore } from '../store/eventBusStore';

declare global {
  interface Window {
    __streamPush?: (instanceId: string, line: string) => void;
    __streamExit?: (instanceId: string) => void;
    __streamError?: (instanceId: string, error: string) => void;
  }
}

export function initStreamBridge() {
  window.__streamPush = (instanceId: string, line: string) => {
    const parsed = parseLine(line);
    if (parsed) {
      useChatStore.getState().processEvent(instanceId, parsed);

      // Forward complete assistant messages to the event bus so plugins can read them
      if (parsed.type === 'assistant' || parsed.type === 'message_stop') {
        const session = useChatStore.getState().sessions.get(instanceId);
        if (session) {
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg && 'blocks' in lastMsg && lastMsg.role === 'assistant') {
            // Extract plain text from blocks for easy consumption
            const text = lastMsg.blocks
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n');
            useEventBusStore.getState().dispatch('chat:response', {
              instanceId,
              role: 'assistant',
              text,
              blocks: lastMsg.blocks,
              isStreaming: lastMsg.isStreaming,
              timestamp: Date.now(),
            });
          }
        }
      }

      // Dispatch chat:result when the CLI finishes a full turn (all tool calls done, waiting for input)
      if (parsed.type === 'result') {
        const session = useChatStore.getState().sessions.get(instanceId);
        if (session) {
          // Collect all text from the last assistant message
          const lastMsg = session.messages[session.messages.length - 1];
          const text = (lastMsg && 'blocks' in lastMsg && lastMsg.role === 'assistant')
            ? lastMsg.blocks
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map(b => b.text)
                .join('\n')
            : '';
          useEventBusStore.getState().dispatch('chat:result', {
            instanceId,
            text,
            timestamp: Date.now(),
          });
        }
      }
    }
  };

  window.__streamExit = (instanceId: string) => {
    useChatStore.getState().setStreaming(instanceId, false);
  };

  window.__streamError = (instanceId: string, error: string) => {
    console.error(`[stream-error:${instanceId}]`, error);
    // Set error in store so the user sees it, and reset streaming state
    const store = useChatStore.getState();
    const session = store.sessions.get(instanceId);
    if (session) {
      useChatStore.setState((state) => {
        const next = new Map(state.sessions);
        const s = next.get(instanceId);
        if (s) {
          next.set(instanceId, { ...s, error: error, isStreaming: false });
        }
        return { sessions: next };
      });
    }
  };

  // ─── Event Bus: plugins can send messages to chat instances ──────────────
  initChatSendListener();
}

/**
 * Listen for 'chat:send' events on the event bus.
 * When a plugin calls ClaudeGUI.chat.send(targetId, message),
 * the bridge dispatches 'chat:send'. We pick it up here, add
 * the user message to the target chat session, and invoke the
 * Rust stream_send_message command.
 */
function initChatSendListener() {
  const bus = useEventBusStore.getState();
  // Use a wildcard instance ID so we receive all chat:send events
  bus.subscribe('chat:send', '__stream_bridge__', (data: unknown) => {
    const payload = data as {
      targetId: string;
      message: string;
      sourceId: string;
      sourcePlugin: string;
    };
    const { targetId, message } = payload;

    // Verify the target has a chat session
    const session = useChatStore.getState().sessions.get(targetId);
    if (!session) {
      console.warn(`[streamBridge] chat:send target "${targetId}" has no active session`);
      return;
    }
    if (session.isStreaming) {
      console.warn(`[streamBridge] chat:send target "${targetId}" is currently streaming, message queued`);
      // Wait for streaming to finish then send
      const checkAndSend = () => {
        const s = useChatStore.getState().sessions.get(targetId);
        if (s && !s.isStreaming) {
          sendToChat(targetId, message);
        } else {
          setTimeout(checkAndSend, 500);
        }
      };
      setTimeout(checkAndSend, 500);
      return;
    }

    sendToChat(targetId, message);
  });
}

async function sendToChat(targetId: string, message: string) {
  useChatStore.getState().addUserMessage(targetId, message);
  useChatStore.getState().setStreaming(targetId, true);
  try {
    await invoke('stream_send_message', { id: targetId, message });
  } catch (err) {
    console.error(`[streamBridge] chat:send failed for "${targetId}":`, err);
    useChatStore.setState((state) => {
      const next = new Map(state.sessions);
      const s = next.get(targetId);
      if (s) {
        next.set(targetId, { ...s, error: String(err), isStreaming: false });
      }
      return { sessions: next };
    });
  }
}
