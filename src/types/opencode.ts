export type OpenCodeProvider = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'lmstudio' | 'custom';

/** Credentials are deliberately NOT part of panel configs, defaults, or saves. */
export interface OpenCodeOptions {
  provider: OpenCodeProvider;
  model: string;
  baseUrl: string;
  executablePath: string;
  permission: 'ask' | 'allow';
  agent: 'build' | 'plan';
  instructions: string;
  contextLimit: number;
  outputLimit: number;
  projectConfig: boolean;
}
export interface OpenCodeConfig extends OpenCodeOptions { cwd: string; dataId: string }
export interface OpenCodePart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  url?: string;
  mime?: string;
  filename?: string;
  state?: { status: string; input?: Record<string, unknown>; output?: string; error?: string; title?: string };
}
export interface OpenCodeMessage {
  info: { id: string; role: 'user' | 'assistant'; error?: { name?: string; data?: { message?: string } }; time?: { created: number; completed?: number }; modelID?: string; providerID?: string; cost?: number };
  parts: OpenCodePart[];
}
export interface OpenCodePermission { id: string; sessionID: string; permission: string; patterns: string[]; metadata: Record<string, unknown> }
export interface OpenCodeQuestion {
  id: string;
  sessionID: string;
  questions: Array<{ header: string; question: string; options: Array<{ label: string; description: string }>; multiple?: boolean; custom?: boolean }>;
}
export interface OpenCodeSnapshot {
  generation: string;
  revision?: string;
  sessionId: string;
  connected: boolean;
  model?: string;
  agent?: 'build' | 'plan';
  status: { type: 'idle' | 'busy' | 'retry'; message?: string };
  messages: OpenCodeMessage[];
  permissions: OpenCodePermission[];
  questions: OpenCodeQuestion[];
  error?: string;
}
