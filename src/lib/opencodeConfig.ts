import type { OpenCodeOptions, OpenCodeProvider, OpenCodeMessage } from '../types/opencode';
import type { ForkMessage } from '../types/instance';
export const OPENCODE_PROVIDERS: Record<OpenCodeProvider, string> = {
  openrouter: 'OpenRouter', openai: 'OpenAI API', anthropic: 'Anthropic API', gemini: 'Google Gemini API',
  ollama: 'Ollama · local', lmstudio: 'LM Studio · local', custom: 'Custom OpenAI-compatible API',
};
export const DEFAULT_OPENCODE_OPTIONS: OpenCodeOptions = {
  provider: 'openrouter', model: '', baseUrl: '', executablePath: '', permission: 'ask', agent: 'build', instructions: '',
  contextLimit: 32768, outputLimit: 4096, projectConfig: false,
};
export function isCompatibleProvider(provider: OpenCodeProvider): boolean { return ['ollama', 'lmstudio', 'custom'].includes(provider); }
export function openCodeEndpoint(provider: OpenCodeProvider, baseUrl: string): string {
  const raw = baseUrl.trim() || (provider === 'ollama' ? 'http://127.0.0.1:11434/v1' : provider === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : '');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) base URL without credentials, query, or fragment.');
  return raw.replace(/\/+$/, '') + (url.pathname.replace(/\//g, '') ? '' : '/v1');
}
export function openCodeKeySlot(config: OpenCodeOptions): string {
  return isCompatibleProvider(config.provider) ? `opencode:${openCodeEndpoint(config.provider, config.baseUrl)}` : config.provider;
}
export function openCodeTranscript(messages: OpenCodeMessage[]): ForkMessage[] {
  return messages.map(m => ({ role: m.info.role, content: m.parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('\n') })).filter(m => m.content.trim());
}
