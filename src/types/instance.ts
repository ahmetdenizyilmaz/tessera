/** 'claude' is the Claude Code CLI (subscription login, tools, agentic).
 *  'anthropic' is the Messages API with your own key — plain chat only. */
export type LlmProvider = 'claude' | 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'lmstudio';

export type ThinkingMode = 'auto' | 'think' | 'think_hard' | 'think_harder' | 'ultrathink';

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  systemPrompt: string;
  temperature?: number;
  baseUrl?: string;
}

export interface InstanceConfig {
  cwd: string;
  model: string;
  dangerouslySkipPermissions: boolean;
  permissionMode: string;
  allowedTools: string[];
  maxBudget: number;
  systemPrompt: string;
  agentMode: boolean;
  llmConfig?: LlmConfig;
  /** Chosen at creation and fixed for the session's lifetime — chat and
   *  terminal are separate Claude sessions. Legacy instances default to chat. */
  panelView?: 'chat' | 'terminal';
}

export interface ClaudeInstance {
  id: string;
  name: string;
  color: string;
  config: InstanceConfig;
  status: 'starting' | 'running' | 'stopped' | 'error';
  claudeSessionId?: string;
}

export const INSTANCE_COLORS: string[] = [
  '#4a9eff',
  '#ff6b6b',
  '#51cf66',
  '#ffd43b',
  '#cc5de8',
  '#ff922b',
  '#20c997',
  '#f06595',
];
