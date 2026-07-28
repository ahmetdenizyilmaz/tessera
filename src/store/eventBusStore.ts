import { create } from 'zustand';

// ─── Types ───────────────────────────────────────────────────────────────────

type EventHandler = (data: unknown) => void;

/** event name -> instanceId -> Set of handlers */
type SubscriptionMap = Map<string, Map<string, Set<EventHandler>>>;

// ─── Module-Level Subscriptions (avoids deep cloning on every subscribe) ─────
// Anchored to globalThis so it survives Vite HMR module re-evaluation.

const subscriptions: SubscriptionMap =
  (globalThis as Record<string, unknown>).__eventBusSubscriptions as SubscriptionMap ??
  ((globalThis as Record<string, unknown>).__eventBusSubscriptions = new Map<string, Map<string, Set<EventHandler>>>());

// ─── Direct Message Handlers (module-level for performance) ──────────────────
// Anchored to globalThis so it survives Vite HMR module re-evaluation.
// targetInstanceId -> Set of handlers

const directHandlers: Map<string, Set<EventHandler>> =
  (globalThis as Record<string, unknown>).__eventBusDirectHandlers as Map<string, Set<EventHandler>> ??
  ((globalThis as Record<string, unknown>).__eventBusDirectHandlers = new Map<string, Set<EventHandler>>());

// ─── Event Bus Store ─────────────────────────────────────────────────────────

interface EventBusState {
  /**
   * Subscribe to an event for a given instance.
   * Returns an unsubscribe function.
   */
  subscribe: (event: string, instanceId: string, handler: EventHandler) => () => void;

  /**
   * Dispatch an event to all subscribers.
   * Uses getState() internally — never triggers re-renders.
   */
  dispatch: (event: string, data: unknown, sourceId?: string) => void;

  /**
   * Send a direct message to a specific instance.
   * The target must have registered a direct message handler via subscribe('plugin:message', targetId, handler).
   */
  sendTo: (targetId: string, data: unknown, sourceId: string) => void;

  /**
   * Broadcast on a named channel.
   * Dispatches as 'broadcast:{channel}' event to all subscribers.
   */
  broadcast: (channel: string, data: unknown, sourceId: string) => void;

  /**
   * Clean up all subscriptions for a destroyed instance.
   * Call this when a panel/instance is removed.
   */
  cleanupInstance: (instanceId: string) => void;
}

export const useEventBusStore = create<EventBusState>(() => ({
  subscribe: (event: string, instanceId: string, handler: EventHandler) => {
    // Mutate the module-level map directly — no Zustand state to clone.
    let instanceMap = subscriptions.get(event);
    if (!instanceMap) {
      instanceMap = new Map();
      subscriptions.set(event, instanceMap);
    }

    let handlers = instanceMap.get(instanceId);
    if (!handlers) {
      handlers = new Set();
      instanceMap.set(instanceId, handlers);
    }

    handlers.add(handler);

    // Also register in direct handlers map for sendTo
    if (event === 'plugin:message') {
      let handlerSet = directHandlers.get(instanceId);
      if (!handlerSet) {
        handlerSet = new Set();
        directHandlers.set(instanceId, handlerSet);
      }
      handlerSet.add(handler);
    }

    // Return unsubscribe function
    return () => {
      const instMap = subscriptions.get(event);
      if (!instMap) return;

      const hdlrs = instMap.get(instanceId);
      if (!hdlrs) return;

      hdlrs.delete(handler);

      if (hdlrs.size === 0) {
        instMap.delete(instanceId);
      }

      if (instMap.size === 0) {
        subscriptions.delete(event);
      }

      // Clean up direct handler
      if (event === 'plugin:message') {
        const handlerSet = directHandlers.get(instanceId);
        if (handlerSet) {
          handlerSet.delete(handler);
          if (handlerSet.size === 0) {
            directHandlers.delete(instanceId);
          }
        }
      }
    };
  },

  dispatch: (event: string, data: unknown, _sourceId?: string) => {
    const instanceMap = subscriptions.get(event);
    if (!instanceMap) return;

    for (const [, handlers] of instanceMap) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[eventBus] Error dispatching "${event}":`, err);
        }
      }
    }
  },

  sendTo: (targetId: string, data: unknown, sourceId: string) => {
    const handlerSet = directHandlers.get(targetId);
    if (!handlerSet || handlerSet.size === 0) {
      console.warn(`[eventBus] sendTo: no handlers for instance "${targetId}"`);
      return;
    }

    const message = { targetId, sourceId, data };
    for (const handler of handlerSet) {
      try {
        handler(message);
      } catch (err) {
        console.error(`[eventBus] Error in sendTo "${targetId}":`, err);
      }
    }
  },

  broadcast: (channel: string, data: unknown, sourceId: string) => {
    const event = `broadcast:${channel}`;
    useEventBusStore.getState().dispatch(event, { channel, sourceId, data });
  },

  cleanupInstance: (instanceId: string) => {
    for (const [event, instanceMap] of subscriptions) {
      if (instanceMap.has(instanceId)) {
        instanceMap.delete(instanceId);
        if (instanceMap.size === 0) {
          subscriptions.delete(event);
        }
      }
    }

    // Clean up direct handlers
    directHandlers.delete(instanceId);
  },
}));
