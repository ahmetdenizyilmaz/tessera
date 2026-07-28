import { useEffect, useRef } from 'react';
import { useInstanceStore } from '../store/instanceStore';
import { useLayoutStore } from '../store/layoutStore';
import { useLlmChatStore } from '../store/llmChatStore';
import { useChatStore } from '../store/chatStore';
import { useOfficeGameStore } from '../store/officeGameStore';
import { getDeskPositions, getActivityLocation } from '../engine/defaultOffice';
import type { WorkerActivity } from '../types/office';
import type { StreamEvent, StreamAssistantMessage, ChatMessage } from '../types/stream';

/** Derive activity from a stream event (granular streaming format) */
function deriveFromStreamEvent(event: StreamEvent): WorkerActivity | null {
  switch (event.type) {
    case 'content_block_start': {
      const block = (event as any).content_block;
      if (block?.type === 'thinking') return 'thinking';
      if (block?.type === 'text') return 'responding';
      if (block?.type === 'tool_use') return mapToolName(block.name);
      return null;
    }
    case 'content_block_delta': {
      const delta = (event as any).delta;
      if (delta?.type === 'thinking_delta') return 'thinking';
      if (delta?.type === 'text_delta') return 'responding';
      return null;
    }
    case 'assistant':
      return deriveFromAssistantMessage(event as StreamAssistantMessage);
    case 'permission':
      return 'awaiting_permission';
    case 'error':
      return 'error';
    case 'result': {
      const result = event as any;
      if (result.is_error || (result.subtype && result.subtype !== 'success')) return 'error';
      return 'idle';
    }
    case 'message_stop':
      return 'idle';
    default:
      return null;
  }
}

/** Derive activity from a complete assistant message (Claude CLI format) */
function deriveFromAssistantMessage(event: StreamAssistantMessage): WorkerActivity {
  const content = event.message.content;
  if (!content || content.length === 0) return 'responding';

  // Use the last content block to determine current activity
  const lastBlock = content[content.length - 1];
  if (lastBlock.type === 'thinking') return 'thinking';
  if (lastBlock.type === 'tool_use') return mapToolName(lastBlock.name ?? '');
  return 'responding';
}

/** Map tool name to worker activity */
function mapToolName(name: string): WorkerActivity {
  switch (name) {
    case 'Read': return 'reading_file';
    case 'Edit': return 'editing_file';
    case 'Write': return 'writing_file';
    case 'Bash': return 'running_command';
    case 'Glob': case 'Grep': return 'searching_files';
    case 'WebSearch': case 'WebFetch': return 'searching_web';
    case 'TodoRead': case 'TodoWrite': return 'managing_todos';
    case 'ToolSearch': return 'searching_files';
    default: return 'using_tool';
  }
}

/** Determine if a desk-bound activity (worker stays at their desk) */
function isDeskActivity(activity: WorkerActivity): boolean {
  return activity === 'responding' || activity === 'editing_file' ||
         activity === 'writing_file' || activity === 'using_tool';
}

/** Derive activity from accumulated messages (for chatStore subscription) */
function deriveFromMessages(messages: ChatMessage[], isStreaming: boolean): WorkerActivity {
  if (!isStreaming && messages.length === 0) return 'new';
  if (!isStreaming) return 'idle';

  // Look at the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if ('blocks' in msg && msg.role === 'assistant') {
      const lastBlock = msg.blocks[msg.blocks.length - 1];
      if (!lastBlock) return 'responding';
      if (lastBlock.type === 'thinking') return 'thinking';
      if (lastBlock.type === 'tool_use') return mapToolName(lastBlock.name);
      return 'responding';
    }
  }
  return 'responding';
}

// Derive activity from LLM chat state
function deriveLlmActivity(
  isStreaming: boolean,
  messageCount: number,
  error: string | null,
): WorkerActivity {
  if (error) return 'error';
  if (isStreaming) return 'responding';
  if (messageCount === 0) return 'new';
  return 'idle';
}

export function useWorkerActivity(): void {
  const deskIndexRef = useRef(0);
  const lastActivityRef = useRef(new Map<string, WorkerActivity>());

  useEffect(() => {
    const deskPositions = getDeskPositions();

    // Immediate sync: add workers for existing instances, remove stale workers
    {
      const instances = useInstanceStore.getState().instances;
      const officeStore = useOfficeGameStore.getState();
      // Remove stale workers (survives HMR)
      for (const id of Object.keys(officeStore.workers)) {
        if (!instances.has(id)) {
          officeStore.removeWorker(id);
        }
      }
      // Add workers for instances that already exist
      for (const id of instances.keys()) {
        if (!officeStore.workers[id]) {
          const deskPos = deskPositions[deskIndexRef.current % deskPositions.length];
          deskIndexRef.current++;
          officeStore.addWorker(id, deskPos);
        }
      }
    }

    function moveWorker(id: string, activity: WorkerActivity) {
      const officeStore = useOfficeGameStore.getState();
      const worker = officeStore.workers[id];
      if (!worker) return;

      // Skip if activity hasn't changed
      const lastActivity = lastActivityRef.current.get(id);
      if (lastActivity === activity) return;
      lastActivityRef.current.set(id, activity);

      officeStore.updateWorkerActivity(id, activity);

      // Determine target position
      if (isDeskActivity(activity)) {
        officeStore.setWorkerTarget(id, worker.assignedDesk);
      } else if (activity !== 'idle' || !worker.isWalking) {
        const target = getActivityLocation(activity, officeStore.layout.rooms);
        officeStore.setWorkerTarget(id, target);
      }
    }

    // Watch for instance changes — add/remove workers
    const unsubInstances = useInstanceStore.subscribe((state) => {
      const instances = state.instances;
      const officeStore = useOfficeGameStore.getState();

      for (const id of instances.keys()) {
        if (!officeStore.workers[id]) {
          const deskPos = deskPositions[deskIndexRef.current % deskPositions.length];
          deskIndexRef.current++;
          officeStore.addWorker(id, deskPos);
        }
      }

      for (const id of Object.keys(officeStore.workers)) {
        if (!instances.has(id)) {
          officeStore.removeWorker(id);
          lastActivityRef.current.delete(id);
        }
      }
    });

    // Watch chatStore for Claude activity updates (replaces broken Tauri listen())
    const unsubChat = useChatStore.subscribe((state) => {
      const instances = useInstanceStore.getState().instances;
      const panelTypes = useLayoutStore.getState().panelTypes;

      for (const [id, session] of state.sessions) {
        // Skip LLM instances (handled below)
        if ((panelTypes[id] as string) === 'llm') continue;
        if (!instances.has(id)) continue;

        const activity = deriveFromMessages(
          session.messages,
          session.isStreaming,
        );
        moveWorker(id, activity);
      }
    });

    // Watch LLM chat store for LLM instance activity
    const unsubLlm = useLlmChatStore.subscribe((state) => {
      const panelTypes = useLayoutStore.getState().panelTypes;

      for (const [id, conv] of Object.entries(state.conversations)) {
        if ((panelTypes[id] as string) === 'llm') {
          const activity = deriveLlmActivity(conv.isStreaming, conv.messages.length, conv.error);
          moveWorker(id, activity);
        }
      }
    });

    return () => {
      unsubInstances();
      unsubChat();
      unsubLlm();
    };
  }, []);
}
