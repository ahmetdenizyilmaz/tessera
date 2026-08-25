/** 'claude' is the Claude Code CLI (subscription login, tools, agentic).
 *  'anthropic' is the Messages API with your own key — plain chat only. */
export type LlmProvider = 'claude' | 'anthropic' | 'openai' | 'openrouter' | 'gemini' | 'ollama' | 'lmstudio';

/** Where a Claude Code panel's CLI traffic goes. 'anthropic' = the CLI's
 *  normal path (subscription login), untouched. Every other gateway injects
 *  ANTHROPIC_BASE_URL/AUTH_TOKEN into that panel's process only:
 *  'openrouter' = openrouter.ai, 'ollama' = the local Ollama server
 *  (Anthropic-compatible since v0.14), 'custom' = any other
 *  Anthropic-compatible URL (llama.cpp server, LiteLLM, …). */
export interface ClaudeRouting {
  gateway: 'anthropic' | 'openrouter' | 'ollama' | 'custom';
  /** Gateway-side model id mapped onto the sonnet/opus tiers
   *  (e.g. "qwen/qwen3-coder:free" or "qwen3:30b-a3b-q8_0"). */
  model?: string;
  /** Model id for the haiku tier (background/fast tasks); falls back to `model`. */
  smallModel?: string;
  /** Base URL for gateway 'custom' (must speak the Anthropic Messages API). */
  customBaseUrl?: string;
}

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
  /** Per-panel Claude Code gateway routing. Absent = normal Anthropic path. */
  routing?: ClaudeRouting;
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
