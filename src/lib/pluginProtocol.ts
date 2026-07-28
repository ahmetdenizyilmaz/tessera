import type { HostToPluginMessage, PluginToHostMessage } from '../types/plugin';

// ─── Message Type Constants ──────────────────────────────────────────────────

/** Host -> Plugin: Initialization with instance ID, theme, etc. */
export const SDK_INIT = 'sdk:init' as const;

/** Host -> Plugin: Event delivery (from event bus) */
export const SDK_EVENT = 'sdk:event' as const;

/** Host -> Plugin: Response to a plugin SDK call */
export const SDK_RESPONSE = 'sdk:response' as const;

/** Host -> Plugin: Theme change notification */
export const SDK_THEME = 'sdk:theme' as const;

/** Host -> Plugin: Destruction notice (plugin gets 500ms to save) */
export const SDK_DESTROY = 'sdk:destroy' as const;

/** Plugin -> Host: SDK API method call */
export const SDK_CALL = 'sdk:call' as const;

/** Plugin -> Host: Emit an event to the event bus */
export const SDK_EMIT = 'sdk:emit' as const;

/** Plugin -> Host: Subscribe to an event */
export const SDK_SUBSCRIBE = 'sdk:subscribe' as const;

/** Plugin -> Host: Unsubscribe from an event */
export const SDK_UNSUBSCRIBE = 'sdk:unsubscribe' as const;

// ─── Valid message types for validation ──────────────────────────────────────

const VALID_PLUGIN_TYPES: Set<string> = new Set([SDK_CALL, SDK_EMIT, SDK_SUBSCRIBE, SDK_UNSUBSCRIBE]);

// ─── Request ID Counter (anchored to globalThis for HMR survival) ───────────

const requestCounterState: { value: number } = (globalThis as any).__pluginReqCounter ??= { value: 0 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a unique request ID for correlating postMessage request/response pairs.
 */
export function createRequestId(): string {
  requestCounterState.value++;
  return `req-${requestCounterState.value}-${Date.now()}`;
}

/**
 * Validate an incoming message from a plugin iframe.
 * Returns true if the message has the correct shape for a PluginToHostMessage.
 */
export function isPluginMessage(msg: unknown): msg is PluginToHostMessage {
  if (msg == null || typeof msg !== 'object') return false;
  const obj = msg as Record<string, unknown>;
  if (typeof obj.type !== 'string') return false;
  if (typeof obj.requestId !== 'string') return false;
  if (typeof obj.method !== 'string') return false;
  if (!Array.isArray(obj.args)) return false;
  return VALID_PLUGIN_TYPES.has(obj.type);
}

/**
 * Create a response message to send back to a plugin iframe.
 */
export function createResponse(
  requestId: string,
  data: unknown,
  error?: string,
): HostToPluginMessage {
  return {
    type: SDK_RESPONSE,
    requestId,
    data: error != null ? { error } : data,
  };
}
