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
  cwd?: string,
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

  if (routing.gateway === 'ollama' || routing.gateway === 'custom') {
    // Local prefill of Claude Code's ~17k-token prompt can sit silent for
    // 5+ minutes on big dense models. Without these, the CLI's idle
    // watchdogs (default 3-5 min) kill and retry requests that are in
    // fact still working.
    env.API_TIMEOUT_MS = '1800000';
    env.CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS = '1200000';
    env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '1200000';
    env.API_FORCE_IDLE_TIMEOUT = '0';
  } else {
    // OpenRouter free routes can queue; a milder bump avoids spurious
    // retries without hiding a genuinely dead connection for long.
    env.CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS = '600000';
    // The CLI asks for a 64k output budget, which OpenRouter charges against
    // up front: on the free tier every request dies with "API Error: 402 ...
    // you requested up to 64000 tokens, but can only afford 688". Ask for a
    // budget a free route can actually front.
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192';
  }

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

  // `/model` in the CLI saves the pick as the default for every NEW session,
  // in the shared ~/.claude/settings.json. Switching a routed panel's model
  // used to leave e.g. "openrouter/free" as the default for normal Claude
  // panels and for `claude` in a terminal — a gateway model they cannot reach.
  // Give routed panels their own config home so that write stays contained.
  try {
    const dir = await invoke<string>('claude_routed_config_dir', {
      key: routing.gateway === 'custom' ? baseUrl : routing.gateway,
      model: model || null,
      cwd: cwd || null,
    });
    if (dir) env.CLAUDE_CONFIG_DIR = dir;
  } catch (err) {
    // Routing still works without the split; the panel just shares the
    // user's config home again, so say why rather than failing the spawn.
    console.error('[routingEnv] no private config dir, /model will hit the shared one:', err);
  }

  return env;
}
