// ─── Plugin SDK Source Code ──────────────────────────────────────────────────
// This module exports the SDK source as a string constant.
// The string is injected into plugin iframes as a <script> tag.
// It creates window.Tessera — the global API available to plugins.
//
// IMPORTANT: This is self-contained JavaScript. No imports, no TypeScript types
// at runtime. It must run standalone in an iframe context.

export const PLUGIN_SDK_SOURCE = `
(function() {
  'use strict';

  // ─── Internal State ─────────────────────────────────────────────────────────

  var _instanceId = null;
  var _pluginName = null;
  var _groupId = null;
  var _initialized = false;
  var _requestCounter = 0;
  var _pendingRequests = {};    // requestId -> { resolve, reject, timer }
  var _eventHandlers = {};      // event -> Set<handler>
  var _destroyHandlers = [];
  var _toolbarHandler = null;
  var _themeChangeHandlers = [];
  var _instanceChangeHandlers = [];
  var _chatMessageHandlers = [];
  var _chatResponseHandlers = [];
  var _chatResultHandlers = [];
  var _pluginMessageHandlers = [];
  var _broadcastHandlers = {};  // channel -> Set<handler>
  var _currentTheme = null;
  var REQUEST_TIMEOUT = 300000;  // 5min timeout for long-running SDK calls (e.g. agent creation)

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function nextRequestId() {
    _requestCounter++;
    return 'sdk-' + _requestCounter + '-' + Date.now();
  }

  function sendToHost(type, method, args) {
    var requestId = nextRequestId();
    var msg = {
      type: type,
      requestId: requestId,
      method: method,
      args: args || []
    };
    parent.postMessage(msg, '*');
    return requestId;
  }

  function callHost(method, args) {
    return new Promise(function(resolve, reject) {
      var requestId = sendToHost('sdk:call', method, args);
      var timer = setTimeout(function() {
        if (_pendingRequests[requestId]) {
          delete _pendingRequests[requestId];
          reject(new Error('SDK call timed out: ' + method));
        }
      }, REQUEST_TIMEOUT);
      _pendingRequests[requestId] = { resolve: resolve, reject: reject, timer: timer };
    });
  }

  function fireToHost(method, args) {
    sendToHost('sdk:call', method, args);
  }

  // ─── Message Handler (from host) ───────────────────────────────────────────

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'sdk:init':
        _instanceId = msg.data.instanceId;
        _pluginName = msg.data.pluginName;
        _groupId = msg.data.groupId || null;
        _currentTheme = msg.data.theme || null;
        _initialized = true;
        // Fire 'init' event handlers
        fireEvent('init', msg.data);
        break;

      case 'sdk:response':
        var pending = _pendingRequests[msg.requestId];
        if (pending) {
          clearTimeout(pending.timer);
          delete _pendingRequests[msg.requestId];
          if (msg.data && msg.data.error) {
            pending.reject(new Error(msg.data.error));
          } else {
            pending.resolve(msg.data);
          }
        }
        break;

      case 'sdk:event':
        fireEvent(msg.event, msg.data);
        break;

      case 'sdk:theme':
        _currentTheme = msg.data;
        for (var i = 0; i < _themeChangeHandlers.length; i++) {
          try { _themeChangeHandlers[i](msg.data); } catch(e) { console.error('[SDK] theme handler error:', e); }
        }
        break;

      case 'sdk:destroy':
        var promises = [];
        for (var d = 0; d < _destroyHandlers.length; d++) {
          try {
            var result = _destroyHandlers[d]();
            if (result && typeof result.then === 'function') {
              promises.push(result);
            }
          } catch(e) {
            console.error('[SDK] destroy handler error:', e);
          }
        }
        // Signal host that cleanup is done
        if (promises.length > 0) {
          Promise.all(promises).then(function() {
            fireToHost('lifecycle:destroyAck', []);
          }).catch(function() {
            fireToHost('lifecycle:destroyAck', []);
          });
        } else {
          fireToHost('lifecycle:destroyAck', []);
        }
        break;
    }
  });

  function fireEvent(event, data) {
    var handlers = _eventHandlers[event];
    if (!handlers) return;
    handlers.forEach(function(handler) {
      try { handler(data); } catch(e) { console.error('[SDK] event handler error:', event, e); }
    });
  }

  // Also route specific events to dedicated handler lists
  function setupEventRouting() {
    // Route chat:message events
    on('chat:message', function(data) {
      for (var i = 0; i < _chatMessageHandlers.length; i++) {
        try { _chatMessageHandlers[i](data); } catch(e) { console.error('[SDK] chatMessage handler:', e); }
      }
    });
    // Route chat:response events
    on('chat:response', function(data) {
      for (var i = 0; i < _chatResponseHandlers.length; i++) {
        try { _chatResponseHandlers[i](data); } catch(e) { console.error('[SDK] chatResponse handler:', e); }
      }
    });
    // Route chat:result events (turn complete — CLI finished all tool calls)
    on('chat:result', function(data) {
      for (var i = 0; i < _chatResultHandlers.length; i++) {
        try { _chatResultHandlers[i](data); } catch(e) { console.error('[SDK] chatResult handler:', e); }
      }
    });
    // Route plugin:message events
    on('plugin:message', function(data) {
      for (var i = 0; i < _pluginMessageHandlers.length; i++) {
        try { _pluginMessageHandlers[i](data); } catch(e) { console.error('[SDK] pluginMessage handler:', e); }
      }
    });
    // Route instance:list events
    on('instance:list', function(data) {
      for (var i = 0; i < _instanceChangeHandlers.length; i++) {
        try { _instanceChangeHandlers[i](data); } catch(e) { console.error('[SDK] instanceChange handler:', e); }
      }
    });
    // Route toolbar:button events
    on('toolbar:button', function(data) {
      if (_toolbarHandler) {
        try { _toolbarHandler(data.buttonId); } catch(e) { console.error('[SDK] toolbar handler:', e); }
      }
    });
  }

  // ─── Core Event API ─────────────────────────────────────────────────────────

  function on(event, handler) {
    if (!_eventHandlers[event]) {
      _eventHandlers[event] = new Set();
    }
    _eventHandlers[event].add(handler);
    return function() { off(event, handler); };
  }

  function off(event, handler) {
    var handlers = _eventHandlers[event];
    if (handlers) {
      handlers.delete(handler);
    }
  }

  function emit(event, data) {
    fireToHost('event:emit', [event, data]);
  }

  // ─── Build the SDK Object ──────────────────────────────────────────────────

  var sdk = {
    get instanceId() { return _instanceId; },
    get pluginName() { return _pluginName; },
    get groupId() { return _groupId; },

    on: on,
    off: off,
    emit: emit,

    instances: {
      list: function() {
        return callHost('instances:list', []);
      },
      get: function(id) {
        return callHost('instances:get', [id]);
      },
      create: function(config) {
        return callHost('instances:create', [config]);
      },
      remove: function(id) {
        return callHost('instances:remove', [id]);
      },
      onChanged: function(handler) {
        _instanceChangeHandlers.push(handler);
        return function() {
          var idx = _instanceChangeHandlers.indexOf(handler);
          if (idx >= 0) _instanceChangeHandlers.splice(idx, 1);
        };
      }
    },

    chat: {
      send: function(targetId, message) {
        return callHost('chat:send', [targetId, message]);
      },
      onMessage: function(handler) {
        _chatMessageHandlers.push(handler);
        return function() {
          var idx = _chatMessageHandlers.indexOf(handler);
          if (idx >= 0) _chatMessageHandlers.splice(idx, 1);
        };
      },
      onResponse: function(handler) {
        _chatResponseHandlers.push(handler);
        return function() {
          var idx = _chatResponseHandlers.indexOf(handler);
          if (idx >= 0) _chatResponseHandlers.splice(idx, 1);
        };
      },
      onResult: function(handler) {
        _chatResultHandlers.push(handler);
        return function() {
          var idx = _chatResultHandlers.indexOf(handler);
          if (idx >= 0) _chatResultHandlers.splice(idx, 1);
        };
      },
      getHistory: function(targetId, limit) {
        return callHost('chat:getHistory', [targetId, limit || 50]);
      }
    },

    messaging: {
      send: function(targetId, data) {
        return callHost('messaging:send', [targetId, data]);
      },
      broadcast: function(channel, data) {
        fireToHost('messaging:broadcast', [channel, data]);
      },
      onMessage: function(handler) {
        _pluginMessageHandlers.push(handler);
        return function() {
          var idx = _pluginMessageHandlers.indexOf(handler);
          if (idx >= 0) _pluginMessageHandlers.splice(idx, 1);
        };
      },
      onBroadcast: function(channel, handler) {
        if (!_broadcastHandlers[channel]) {
          _broadcastHandlers[channel] = new Set();
          // Subscribe to broadcast events for this channel
          on('broadcast:' + channel, function(data) {
            _broadcastHandlers[channel].forEach(function(h) {
              try { h(data); } catch(e) { console.error('[SDK] broadcast handler:', e); }
            });
          });
        }
        _broadcastHandlers[channel].add(handler);
        return function() {
          if (_broadcastHandlers[channel]) {
            _broadcastHandlers[channel].delete(handler);
          }
        };
      }
    },

    fs: {
      readFile: function(path) {
        return callHost('fs:readFile', [path]);
      },
      writeFile: function(path, content) {
        return callHost('fs:writeFile', [path, content]);
      },
      readBinary: function(path) {
        return callHost('fs:readBinary', [path]);
      },
      writeBinary: function(path, data) {
        return callHost('fs:writeBinary', [path, data]);
      },
      listDir: function(path) {
        return callHost('fs:listDir', [path || '.']);
      },
      mkdir: function(path) {
        return callHost('fs:mkdir', [path]);
      },
      delete: function(path) {
        return callHost('fs:delete', [path]);
      },
      exists: function(path) {
        return callHost('fs:exists', [path]);
      }
    },

    ui: {
      setTitle: function(title) {
        fireToHost('ui:setTitle', [title]);
      },
      setIcon: function(icon) {
        fireToHost('ui:setIcon', [icon]);
      },
      setAccentColor: function(color) {
        fireToHost('ui:setAccentColor', [color]);
      },
      onToolbarButton: function(handler) {
        _toolbarHandler = handler;
        return function() {
          if (_toolbarHandler === handler) _toolbarHandler = null;
        };
      },
      showNotification: function(message, type) {
        fireToHost('ui:showNotification', [message, type || 'info']);
      },
      setBadge: function(count) {
        fireToHost('ui:setBadge', [count]);
      }
    },

    theme: {
      get current() { return _currentTheme; },
      onChange: function(handler) {
        _themeChangeHandlers.push(handler);
        return function() {
          var idx = _themeChangeHandlers.indexOf(handler);
          if (idx >= 0) _themeChangeHandlers.splice(idx, 1);
        };
      }
    },

    onDestroy: function(handler) {
      _destroyHandlers.push(handler);
    },

    clipboard: {
      read: function() {
        return callHost('clipboard:read', []);
      },
      write: function(text) {
        return callHost('clipboard:write', [text]);
      }
    }
  };

  // Wire up event routing
  setupEventRouting();

  // Expose globally
  window.Tessera = sdk;
})();
`;
