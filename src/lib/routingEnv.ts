import { invoke } from '@tauri-apps/api/core';
import type { ClaudeRouting } from '../types/instance';

export const OPENROUTER_GATEWAY_URL = 'https://openrouter.ai/api';

/**
 * Env vars that make ONE spawned `claude` process talk to OpenRouter's
 * Anthropic-compatible gateway instead of api.anthropic.com. Panels without
 * routing get null — their process env is completely untouched, so the
 * normal Claude Code login path can never be affected by this feature.
 *
 * The CLI's model aliases (sonnet/opus/haiku) resolve through the
 * ANTHROPIC_DEFAULT_*_MODEL vars, so the panel's --model flag keeps working
 * and simply lands on the chosen OpenRouter model.
 */
export async function buildRoutingEnv(
  routing?: ClaudeRouting,
): Promise<Record<string, string> | null> {
  if (!routing || routing.gateway === 'anthropic') return null;

  let baseUrl: string;
  let token: string;
  switch (routing.gateway) {
    case 'openrouter': {
      baseUrl = OPENROUTER_GATEWAY_URL;
      token = '';
      try {
        token = (await invoke<string | null>('llm_get_api_key', { provider: 'openrouter' })) ?? '';
      } catch {
        // No key in the keyring — still inject the base URL so the panel
        // fails loudly against OpenRouter instead of silently billing Anthropic.
      }
      break;
    }
    case 'ollama': {
      // Local server — auth is ignored, but the CLI wants a non-empty token
      // so it doesn't fall back to interactive login.
      const { useSettingsStore } = await import('../store/settingsStore');
      baseUrl = useSettingsStore.getState().settings.ollamaBaseUrl || 'http://localhost:11434';
      token = 'ollama';
      break;
    }
    case 'custom': {
      if (!routing.customBaseUrl?.trim()) return null;
      baseUrl = routing.customBaseUrl.trim();
      token = 'local';
      break;
    }
    default:
      return null;
  }

  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: token,
    // Must be explicitly blank so a host-level Anthropic key can't win.
    ANTHROPIC_API_KEY: '',
  };

  const model = routing.model?.trim();
  const small = routing.smallModel?.trim() || model;
  if (model) {
    env.ANTHROPIC_MODEL = model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
  }
  if (small) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = small;
    env.ANTHROPIC_SMALL_FAST_MODEL = small;
    env.CLAUDE_CODE_SUBAGENT_MODEL = small;
  }
  return env;
}
