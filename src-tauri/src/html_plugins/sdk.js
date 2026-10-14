/* Tessera HTML app SDK v1. Injected before the app's own scripts. */
(() => {
  // WebRTC bypasses normal HTTP/CSP routing and is outside the v1 app API.
  for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'RTCDataChannel']) {
    try { Object.defineProperty(window, key, { value: undefined, writable: false, configurable: false }); } catch {}
  }
  // CSP blocks frame navigation, but browsers still create a same-origin blank
  // frame realm. Apply the transport restriction there before exposing no SDK.
  if (window !== window.top) return;
  const call = (method, params = {}) => window.__TAURI_INTERNALS__.invoke('html_plugin_call', { method, params });
  const ready = Promise.resolve().then(() => call('ready'));
  // An app that does not use the SDK should not produce an unhandled rejection.
  ready.catch(error => console.error('[Tessera app]', error));
  const handlers = new Set();
  let polling = false;
  const api = {
    version: 1,
    ready,
    storage: {
      get: async (key, fallback = null, scope = 'app') => (await call('storage.get', { key, scope })) ?? fallback,
      set: (key, value, scope = 'app') => call('storage.set', { key, value, scope }),
      remove: (key, scope = 'app') => call('storage.remove', { key, scope }),
    },
    ui: {
      setTitle: title => call('ui.title', { title }),
      setBadge: count => call('ui.badge', { count }),
    },
    panels: {
      list: () => call('panels.list'),
      read: (panel, limit = 20) => call('panels.read', { panel, limit }),
      send: (panel, options) => call('panels.send', typeof options === 'string' ? { panel, message: options } : { ...options, panel }),
      onMessage: handler => {
        if (typeof handler !== 'function') throw new TypeError('A message handler is required');
        handlers.add(handler); return () => handlers.delete(handler);
      },
    },
    net: {
      fetch: async (url, options = {}) => {
        const response = await call('net.fetch', { ...options, url });
        return Object.freeze({ ...response, text: async () => response.body, json: async () => JSON.parse(response.body) });
      },
    },
  };
  for (const value of Object.values(api)) if (value && typeof value === 'object') Object.freeze(value);
  Object.defineProperty(window, 'Tessera', { value: Object.freeze(api), writable: false, configurable: false });
  setInterval(async () => {
    if (!handlers.size || polling) return;
    polling = true;
    try {
      const messages = await call('panels.poll');
      for (const message of messages) for (const handler of handlers) {
        try { await handler(Object.freeze({ ...message, reply: text => api.panels.send(message.from, text) })); }
        catch (error) { console.error('[Tessera message handler]', error); }
      }
    } catch (error) { console.warn('[Tessera messages]', error); }
    finally { polling = false; }
  }, 1000);
})();
