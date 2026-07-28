import type { LlmProvider } from './instance';

export interface ProviderMeta {
  id: LlmProvider;
  displayName: string;
  defaultBaseUrl: string;
  models: string[];
  requiresApiKey: boolean;
  supportsModelDiscovery: boolean;
  icon: string;
}

export const LLM_PROVIDERS: Record<Exclude<LlmProvider, 'claude'>, ProviderMeta> = {
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini', 'o3-mini'],
    requiresApiKey: true,
    supportsModelDiscovery: false,
    icon: '\u{1F916}',
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    requiresApiKey: true,
    supportsModelDiscovery: false,
    icon: '\u2728',
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434',
    models: [],
    requiresApiKey: false,
    supportsModelDiscovery: true,
    icon: '\u{1F999}',
  },
  lmstudio: {
    id: 'lmstudio',
    displayName: 'LM Studio',
    defaultBaseUrl: 'http://localhost:1234',
    models: [],
    requiresApiKey: false,
    supportsModelDiscovery: true,
    icon: '\u{1F4BB}',
  },
};
