// Stream-JSON event types for Claude CLI structured output

export interface StreamSystemEvent {
  type: 'system';
  /** 'init' and 'error' are handled; the CLI also emits hook_started,
   *  hook_response, thinking_tokens, compact_boundary, … */
  subtype: 'init' | 'error' | (string & {});
  session_id?: string;
  tools?: string[];
  mcp_servers?: unknown[];
  model?: string;
  error?: string;
  slash_commands?: string[];
  permissionMode?: string;
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

/** Tool results arrive as user-role events carrying tool_result blocks */
export interface StreamUserEvent {
  type: 'user';
  message: {
    role: 'user';
    content:
      | string
      | Array<{
          type: string;
          tool_use_id?: string;
          content?: string | Array<{ type: string; text?: string }>;
          is_error?: boolean;
          text?: string;
        }>;
  };
  /** Non-null when this event belongs to a subagent (Task tool) — skip those */
  parent_tool_use_id?: string | null;
  session_id?: string;
}

export interface StreamResult {
  type: 'result';
  subtype: 'success' | 'error' | 'error_max_turns' | 'error_during_execution';
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

/** SDK control protocol: a request from the CLI that the app must answer */
export interface ControlRequestPayload {
  subtype: string; // 'can_use_tool' | ...
  tool_name?: string;
  display_name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  description?: string;
  permission_suggestions?: unknown[];
  blocked_path?: string;
  requires_user_interaction?: boolean;
  [key: string]: unknown;
}

export interface StreamControlRequest {
  type: 'control_request';
  request_id: string;
  request: ControlRequestPayload;
}

export interface StreamControlCancelRequest {
  type: 'control_cancel_request';
  request_id: string;
}

/** A control request awaiting a user answer, kept in session state */
export interface PendingControlRequest {
  requestId: string;
  request: ControlRequestPayload;
  receivedAt: number;
}

/** Inner payload of a control response ({"behavior":"allow"|"deny",...}) */
export interface ControlResponsePayload {
  behavior: 'allow' | 'deny';
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: unknown[];
  message?: string;
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
  | StreamAssistantMessage
  | StreamUserEvent
  | StreamControlRequest
  | StreamControlCancelRequest;

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
  isError?: boolean;
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
  /** Paths of images attached to this message */
  images?: string[];
}

// System note rendered inline in the transcript (turn failures, notices)
export interface AccumulatedSystemNote {
  id: string;
  role: 'system';
  kind: 'error' | 'warning' | 'info';
  text: string;
  timestamp: number;
}

// Union type for the chat message list
export type ChatMessage = AccumulatedMessage | AccumulatedUserMessage | AccumulatedSystemNote;

// Type guard helpers
export function isUserMessage(msg: ChatMessage): msg is AccumulatedUserMessage {
  return msg.role === 'user' && 'text' in msg && !('blocks' in msg);
}

export function isAssistantMessage(msg: ChatMessage): msg is AccumulatedMessage {
  return 'blocks' in msg;
}

export function isSystemNote(msg: ChatMessage): msg is AccumulatedSystemNote {
  return msg.role === 'system';
}
