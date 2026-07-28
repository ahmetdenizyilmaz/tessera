import type {
  StreamEvent,
  StreamAssistantMessage,
  AccumulatedMessage,
  AccumulatedBlock,
  AccumulatedTextBlock,
  AccumulatedToolUseBlock,
  AccumulatedThinkingBlock,
  AccumulatedSystemNote,
  ChatMessage,
  AccumulatedUserMessage,
} from '../types/stream';

/**
 * Accumulates stream-json events into a renderable message list.
 *
 * Copy-on-write contract: every mutation replaces `allMessages` with a NEW
 * array and replaces the mutated message with a NEW object. Untouched
 * messages keep their identity, so React.memo children skip by reference
 * compare and effects keyed on the array re-run exactly when content changed.
 */
export class StreamAccumulator {
  private allMessages: ChatMessage[] = [];
  /** Mutable working copy of the currently-streaming assistant message */
  private current: AccumulatedMessage | null = null;
  /** Index of the streaming message inside allMessages */
  private currentIdx: number | null = null;
  private currentBlocks: Map<number, AccumulatedBlock> = new Map();
  /** tool_use id → location in allMessages, for linking tool_result events */
  private toolUseLoc: Map<string, { msg: number; block: number }> = new Map();
  /** Message ids that arrived via the partial-streaming path — their complete
   *  `assistant` events only contribute usage/stop_reason, not content */
  private streamedIds: Set<string> = new Set();
  private localCounter = 0;

  /** Write a fresh snapshot of the working message into allMessages */
  private syncCurrent(): void {
    if (this.current === null || this.currentIdx === null) return;
    const snapshot: AccumulatedMessage = {
      ...this.current,
      blocks: this.current.blocks.map((b) => ({ ...b })),
    };
    const next = [...this.allMessages];
    next[this.currentIdx] = snapshot;
    this.allMessages = next;
  }

  processEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'message_start': {
        this.current = {
          id: event.message.id,
          role: event.message.role,
          blocks: [],
          isStreaming: true,
        };
        this.streamedIds.add(event.message.id);
        this.currentBlocks.clear();
        this.allMessages = [...this.allMessages, this.current];
        this.currentIdx = this.allMessages.length - 1;
        // Immediately decouple the stored entry from the working copy
        this.syncCurrent();
        break;
      }

      case 'content_block_start': {
        if (!this.current || this.currentIdx === null) break;
        const { index, content_block } = event;
        let block: AccumulatedBlock;

        if (content_block.type === 'text') {
          block = { type: 'text', text: content_block.text ?? '' } as AccumulatedTextBlock;
        } else if (content_block.type === 'tool_use') {
          block = {
            type: 'tool_use',
            id: content_block.id ?? '',
            name: content_block.name ?? '',
            input: {},
          } as AccumulatedToolUseBlock;
        } else {
          block = { type: 'thinking', thinking: content_block.text ?? '' } as AccumulatedThinkingBlock;
        }

        this.currentBlocks.set(index, block);
        if (block.type === 'tool_use' && block.id) {
          this.toolUseLoc.set(block.id, { msg: this.currentIdx, block: index });
        }
        // Keep blocks array in sync — extend if needed
        while (this.current.blocks.length <= index) {
          const existing = this.currentBlocks.get(this.current.blocks.length);
          this.current.blocks.push(existing ?? ({ type: 'text', text: '' } as AccumulatedTextBlock));
        }
        this.current.blocks[index] = block;
        this.syncCurrent();
        break;
      }

      case 'content_block_delta': {
        if (!this.current) break;
        const block = this.currentBlocks.get(event.index);
        if (!block) break;

        if (event.delta.type === 'text_delta' && block.type === 'text') {
          block.text += event.delta.text ?? '';
        } else if (event.delta.type === 'input_json_delta' && block.type === 'tool_use') {
          // Accumulate partial JSON string; parse on block stop
          const existing = (block as AccumulatedToolUseBlock & { _rawJson?: string })._rawJson ?? '';
          (block as AccumulatedToolUseBlock & { _rawJson?: string })._rawJson =
            existing + (event.delta.partial_json ?? '');
        } else if (event.delta.type === 'thinking_delta' && block.type === 'thinking') {
          block.thinking += event.delta.thinking ?? '';
        }
        this.syncCurrent();
        break;
      }

      case 'content_block_stop': {
        if (!this.current) break;
        const block = this.currentBlocks.get(event.index);
        if (!block) break;

        // Finalize tool_use input by parsing accumulated JSON
        if (block.type === 'tool_use') {
          const raw = (block as AccumulatedToolUseBlock & { _rawJson?: string })._rawJson;
          if (raw) {
            try {
              block.input = JSON.parse(raw);
            } catch {
              block.input = { _raw: raw };
            }
            delete (block as AccumulatedToolUseBlock & { _rawJson?: string })._rawJson;
          }
          this.syncCurrent();
        }
        break;
      }

      case 'message_delta': {
        if (!this.current) break;
        this.current.stopReason = event.delta.stop_reason;
        if (event.usage) {
          this.current.usage = event.usage;
        }
        this.syncCurrent();
        break;
      }

      case 'message_stop': {
        if (!this.current) break;
        this.current.isStreaming = false;
        this.syncCurrent();
        this.current = null;
        this.currentIdx = null;
        this.currentBlocks.clear();
        break;
      }

      // system, result, permission, error are not message-content events
      default:
        break;
    }
  }

  /** The interleaved list of all messages (user + assistant + system notes) */
  getAllMessages(): ChatMessage[] {
    return this.allMessages;
  }

  getCurrentMessage(): AccumulatedMessage | null {
    return this.current;
  }

  /** Insert a user message into the interleaved list */
  addUserMessage(msg: AccumulatedUserMessage): void {
    this.allMessages = [...this.allMessages, msg];
  }

  /**
   * Add a complete assistant message (from Claude CLI's stream-json format).
   * The CLI emits one `assistant` event per content block within a turn, all
   * sharing the same message.id — consecutive events with the same id are
   * merged into one message so React keys stay unique and one API message
   * renders as one bubble.
   */
  addCompleteMessage(event: StreamAssistantMessage): void {
    const { message } = event;

    // Already rendered token-by-token via the streaming path — the complete
    // event would duplicate the content. Merge usage/stop_reason only.
    if (this.streamedIds.has(message.id)) {
      for (let i = this.allMessages.length - 1; i >= 0; i--) {
        const m = this.allMessages[i];
        if ('blocks' in m && m.id === message.id) {
          const merged: AccumulatedMessage = {
            ...m,
            isStreaming: false,
            stopReason: message.stop_reason ?? m.stopReason,
            usage: message.usage ?? m.usage,
          };
          const next = [...this.allMessages];
          next[i] = merged;
          this.allMessages = next;
          break;
        }
      }
      return;
    }

    const newBlocks: AccumulatedBlock[] = message.content.map((c) => {
      if (c.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: c.id ?? '',
          name: c.name ?? '',
          input: c.input ?? {},
        } as AccumulatedToolUseBlock;
      }
      if (c.type === 'thinking') {
        return { type: 'thinking', thinking: c.thinking ?? '' } as AccumulatedThinkingBlock;
      }
      return { type: 'text', text: c.text ?? '' } as AccumulatedTextBlock;
    });

    const lastIdx = this.allMessages.length - 1;
    const last = lastIdx >= 0 ? this.allMessages[lastIdx] : undefined;

    if (
      last &&
      'blocks' in last &&
      last.role === 'assistant' &&
      last.id === message.id
    ) {
      // Merge into the existing message for this turn
      const merged: AccumulatedMessage = {
        ...last,
        blocks: [...last.blocks, ...newBlocks],
        isStreaming: false,
        stopReason: message.stop_reason ?? last.stopReason,
        usage: message.usage ?? last.usage,
      };
      const next = [...this.allMessages];
      next[lastIdx] = merged;
      this.allMessages = next;
      newBlocks.forEach((b, i) => {
        if (b.type === 'tool_use' && b.id) {
          this.toolUseLoc.set(b.id, { msg: lastIdx, block: last.blocks.length + i });
        }
      });
      return;
    }

    const accMsg: AccumulatedMessage = {
      id: message.id,
      role: 'assistant',
      blocks: newBlocks,
      isStreaming: false,
      stopReason: message.stop_reason ?? undefined,
      usage: message.usage,
    };

    this.allMessages = [...this.allMessages, accMsg];
    const msgIdx = this.allMessages.length - 1;
    newBlocks.forEach((b, i) => {
      if (b.type === 'tool_use' && b.id) {
        this.toolUseLoc.set(b.id, { msg: msgIdx, block: i });
      }
    });
  }

  /**
   * Merge fields into a tool_use block's input (copy-on-write). Used to
   * record locally-known data the CLI never echoes back — e.g. the answers
   * the user picked in an AskUserQuestion card.
   */
  mergeToolInput(toolUseId: string, patch: Record<string, unknown>): void {
    const loc = this.toolUseLoc.get(toolUseId);
    if (!loc) return;

    if (this.currentIdx === loc.msg && this.current) {
      const b = this.current.blocks[loc.block];
      if (b?.type === 'tool_use') {
        b.input = { ...b.input, ...patch };
        this.syncCurrent();
      }
      return;
    }

    const msg = this.allMessages[loc.msg];
    if (!msg || !('blocks' in msg)) return;
    const b = msg.blocks[loc.block];
    if (b?.type !== 'tool_use') return;

    const newBlock: AccumulatedToolUseBlock = { ...b, input: { ...b.input, ...patch } };
    const blocks = [...msg.blocks];
    blocks[loc.block] = newBlock;
    const clone: AccumulatedMessage = { ...msg, blocks };
    const next = [...this.allMessages];
    next[loc.msg] = clone;
    this.allMessages = next;
  }

  /** Link a tool result to a previously seen tool_use block by its ID */
  setToolResult(toolUseId: string, result: string, isError?: boolean): void {
    const loc = this.toolUseLoc.get(toolUseId);
    if (!loc) return;

    // Streaming message: mutate the working copy, then snapshot
    if (this.currentIdx === loc.msg && this.current) {
      const b = this.current.blocks[loc.block];
      if (b?.type === 'tool_use') {
        b.result = result;
        if (isError !== undefined) b.isError = isError;
        this.syncCurrent();
      }
      return;
    }

    const msg = this.allMessages[loc.msg];
    if (!msg || !('blocks' in msg)) return;
    const b = msg.blocks[loc.block];
    if (b?.type !== 'tool_use') return;

    const newBlock: AccumulatedToolUseBlock = { ...b, result };
    if (isError !== undefined) newBlock.isError = isError;
    const blocks = [...msg.blocks];
    blocks[loc.block] = newBlock;
    const clone: AccumulatedMessage = { ...msg, blocks };
    const next = [...this.allMessages];
    next[loc.msg] = clone;
    this.allMessages = next;
  }

  /**
   * Append an assistant-styled message produced locally (e.g. the `result`
   * event's text for commands that reply without streaming a message).
   */
  addLocalAssistantMessage(text: string): void {
    const msg: AccumulatedMessage = {
      id: `local-${++this.localCounter}-${Date.now()}`,
      role: 'assistant',
      blocks: [{ type: 'text', text }],
      isStreaming: false,
    };
    this.allMessages = [...this.allMessages, msg];
  }

  /** Append a system note row (errors, turn failures, notices) */
  addSystemNote(kind: AccumulatedSystemNote['kind'], text: string): void {
    const note: AccumulatedSystemNote = {
      id: `note-${++this.localCounter}-${Date.now()}`,
      role: 'system',
      kind,
      text,
      timestamp: Date.now(),
    };
    this.allMessages = [...this.allMessages, note];
  }

  reset(): void {
    this.allMessages = [];
    this.current = null;
    this.currentIdx = null;
    this.currentBlocks.clear();
    this.toolUseLoc.clear();
    this.streamedIds.clear();
  }
}
