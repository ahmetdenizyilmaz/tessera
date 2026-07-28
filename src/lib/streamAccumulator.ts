import type {
  StreamEvent,
  StreamAssistantMessage,
  AccumulatedMessage,
  AccumulatedBlock,
  AccumulatedTextBlock,
  AccumulatedToolUseBlock,
  AccumulatedThinkingBlock,
  ChatMessage,
  AccumulatedUserMessage,
} from '../types/stream';

export class StreamAccumulator {
  private messages: AccumulatedMessage[] = [];
  /** Interleaved list of assistant + user messages in order */
  private allMessages: ChatMessage[] = [];
  private currentMessage: AccumulatedMessage | null = null;
  private currentBlocks: Map<number, AccumulatedBlock> = new Map();
  /** Map of tool_use block IDs to their blocks, for linking results */
  private toolUseBlocksById: Map<string, AccumulatedToolUseBlock> = new Map();

  processEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'message_start': {
        this.currentMessage = {
          id: event.message.id,
          role: event.message.role,
          blocks: [],
          isStreaming: true,
        };
        this.currentBlocks.clear();
        this.messages.push(this.currentMessage);
        this.allMessages.push(this.currentMessage);
        break;
      }

      case 'content_block_start': {
        if (!this.currentMessage) break;
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
        // Track tool_use blocks by ID for result linking
        if (block.type === 'tool_use' && block.id) {
          this.toolUseBlocksById.set(block.id, block);
        }
        // Keep blocks array in sync — extend if needed
        while (this.currentMessage.blocks.length <= index) {
          const existing = this.currentBlocks.get(this.currentMessage.blocks.length);
          this.currentMessage.blocks.push(existing ?? { type: 'text', text: '' } as AccumulatedTextBlock);
        }
        this.currentMessage.blocks[index] = block;
        break;
      }

      case 'content_block_delta': {
        if (!this.currentMessage) break;
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
        break;
      }

      case 'content_block_stop': {
        if (!this.currentMessage) break;
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
        }
        break;
      }

      case 'message_delta': {
        if (!this.currentMessage) break;
        this.currentMessage.stopReason = event.delta.stop_reason;
        if (event.usage) {
          this.currentMessage.usage = event.usage;
        }
        break;
      }

      case 'message_stop': {
        if (!this.currentMessage) break;
        this.currentMessage.isStreaming = false;
        this.currentMessage = null;
        this.currentBlocks.clear();
        break;
      }

      // system, result, permission, error are not message-content events
      default:
        break;
    }
  }

  getMessages(): AccumulatedMessage[] {
    return this.messages;
  }

  /** Get the interleaved list of all messages (assistant + user) in order */
  getAllMessages(): ChatMessage[] {
    return this.allMessages;
  }

  getCurrentMessage(): AccumulatedMessage | null {
    return this.currentMessage;
  }

  /** Insert a user message into the interleaved list */
  addUserMessage(msg: AccumulatedUserMessage): void {
    this.allMessages.push(msg);
  }

  /** Add a complete assistant message (from Claude CLI's stream-json format) */
  addCompleteMessage(event: StreamAssistantMessage): void {
    const { message } = event;
    const blocks: AccumulatedBlock[] = message.content.map((c) => {
      if (c.type === 'tool_use') {
        const block: AccumulatedToolUseBlock = {
          type: 'tool_use',
          id: c.id ?? '',
          name: c.name ?? '',
          input: c.input ?? {},
        };
        if (block.id) this.toolUseBlocksById.set(block.id, block);
        return block;
      }
      if (c.type === 'thinking') {
        return { type: 'thinking', thinking: c.thinking ?? '' } as AccumulatedThinkingBlock;
      }
      return { type: 'text', text: c.text ?? '' } as AccumulatedTextBlock;
    });

    const accMsg: AccumulatedMessage = {
      id: message.id,
      role: 'assistant',
      blocks,
      isStreaming: false,
      stopReason: message.stop_reason ?? undefined,
      usage: message.usage,
    };

    this.messages.push(accMsg);
    this.allMessages.push(accMsg);
  }

  /** Link a tool result to a previously seen tool_use block by its ID */
  setToolResult(toolUseId: string, result: string): void {
    const block = this.toolUseBlocksById.get(toolUseId);
    if (block) {
      block.result = result;
    }
  }

  reset(): void {
    this.messages = [];
    this.allMessages = [];
    this.currentMessage = null;
    this.currentBlocks.clear();
    this.toolUseBlocksById.clear();
  }
}
