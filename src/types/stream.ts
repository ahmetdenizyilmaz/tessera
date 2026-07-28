// Stream-JSON event types for Claude CLI structured output

export interface StreamSystemEvent {
  type: 'system';
  subtype: 'init' | 'error';
  session_id?: string;
  tools?: string[];
  mcp_servers?: string[];
  model?: string;
  error?: string;
}

export interface StreamMessageStart {
  type: 'message_start';
  message: {
    id: string;
    role: 'assistant' | 'user';
    model: string;
  };
}

export interface StreamContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use' | 'thinking';
    id?: string;
    name?: string;
    text?: string;
  };
}

export interface StreamContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: 'text_delta' | 'input_json_delta' | 'thinking_delta';
    text?: string;
    partial_json?: string;
    thinking?: string;
  };
}

export interface StreamContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface StreamMessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface StreamMessageStop {
  type: 'message_stop';
}

export interface StreamResult {
  type: 'result';
  subtype: 'success' | 'error';
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface StreamPermissionRequest {
  type: 'permission';
  tool_name: string;
  tool_input: Record<string, unknown>;
  description?: string;
}

export interface StreamError {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/** Complete assistant message from Claude CLI (stream-json format) */
export interface StreamAssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    model: string;
    content: Array<{
      type: 'text' | 'tool_use' | 'thinking';
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    stop_reason?: string | null;
    usage?: { input_tokens: number; output_tokens: number };
  };
}

export type StreamEvent =
  | StreamSystemEvent
  | StreamMessageStart
  | StreamContentBlockStart
  | StreamContentBlockDelta
  | StreamContentBlockStop
  | StreamMessageDelta
  | StreamMessageStop
  | StreamResult
  | StreamPermissionRequest
  | StreamError
  | StreamAssistantMessage;

// Accumulated content block (after deltas are merged)
export interface AccumulatedTextBlock {
  type: 'text';
  text: string;
}

export interface AccumulatedToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

export interface AccumulatedThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export type AccumulatedBlock =
  | AccumulatedTextBlock
  | AccumulatedToolUseBlock
  | AccumulatedThinkingBlock;

export interface AccumulatedMessage {
  id: string;
  role: 'assistant' | 'user';
  blocks: AccumulatedBlock[];
  isStreaming: boolean;
  usage?: { input_tokens: number; output_tokens: number };
  stopReason?: string;
}

// User message inserted by the frontend (not from stream events)
export interface AccumulatedUserMessage {
  id: string;
  role: 'user';
  text: string;
  timestamp: number;
}

// Union type for the chat message list
export type ChatMessage = AccumulatedMessage | AccumulatedUserMessage;

// Type guard helpers
export function isUserMessage(msg: ChatMessage): msg is AccumulatedUserMessage {
  return 'text' in msg && !('blocks' in msg);
}

export function isAssistantMessage(msg: ChatMessage): msg is AccumulatedMessage {
  return 'blocks' in msg;
}
