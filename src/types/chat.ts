export type ParserState = 'startup' | 'idle' | 'skip_echo' | 'responding';

export interface ThinkingInfo {
  label: string;
  duration: string;
  tokenCount: string;
  mode: string;
  activeTool?: string;
  activeToolArgs?: string;
}

export interface PermissionPrompt {
  title: string;
  lines: string[];
}

export interface ChoiceBlock {
  before: string;
  options: ChoiceOption[];
}

export interface ChoiceOption {
  number: number;
  label: string;
  description?: string;
}

export interface TuiChoice {
  number: number;
  label: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'permission' | 'system';
  content: string;
  timestamp: number;
  images?: string[];
  tuiChoices?: TuiChoice[];
  thinkingInfo?: ThinkingInfo;
  tokenUsage?: TokenUsage;
  isStreaming?: boolean;
  permissionPrompt?: PermissionPrompt & { resolved?: 'yes' | 'no' };
  choiceResolved?: string;
  elapsedMs?: number;
}
