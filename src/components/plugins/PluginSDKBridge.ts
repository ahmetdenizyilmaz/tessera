// ─── Plugin SDK Bridge (Host Side) ──────────────────────────────────────────
// Handles postMessage communication between the host app and plugin iframes.
// Each plugin instance gets its own bridge. The bridge routes SDK calls from
// the iframe to the appropriate Zustand stores and sends responses back.

import { isPluginMessage, createResponse, SDK_INIT, SDK_DESTROY, SDK_EVENT } from '../../lib/pluginProtocol';
import { usePluginStore } from '../../store/pluginStore';
import { useEventBusStore } from '../../store/eventBusStore';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { useChatStore } from '../../store/chatStore';
import { useSettingsStore } from '../../store/settingsStore';
import { invoke } from '@tauri-apps/api/core';
import type { HostToPluginMessage, PluginToHostMessage, InstanceInfo } from '../../types/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PluginBridge {
  /** Send the SDK init message to the iframe */
  sendInit: () => void;
  /** Send the destroy message and wait for grace period */
  sendDestroy: () => Promise<void>;
  /** Clean up the message listener */
  destroy: () => void;
}

// ─── Bridge Factory ─────────────────────────────────────────────────────────

export function createBridge(
  instanceId: string,
  pluginName: string,
  iframe: HTMLIFrameElement,
): PluginBridge {
  let destroyed = false;

  // ─── Send a message to the plugin iframe ──────────────────────────────────

  function postToPlugin(msg: HostToPluginMessage) {
    if (destroyed || !iframe.contentWindow) return;
    try {
      iframe.contentWindow.postMessage(msg, '*');
    } catch (err) {
      console.error(`[PluginBridge:${instanceId}] Failed to post message:`, err);
    }
  }

  // ─── Handle SDK calls from the plugin ────────────────────────────────────

  function handleCall(msg: PluginToHostMessage) {
    const { requestId, method, args } = msg;

    switch (method) {
      // ─── Instance Discovery ─────────────────────────────────────────────
      case 'instances:list': {
        const instances = buildInstanceList();
        postToPlugin(createResponse(requestId, instances));
        break;
      }
      case 'instances:get': {
        const [targetId] = args as [string];
        const found = lookupInstance(targetId);
        postToPlugin(createResponse(requestId, found));
        break;
      }

      // ─── Instance Lifecycle ─────────────────────────────────────────
      case 'instances:create': {
        const [config] = args as [{ name?: string; cwd?: string; model?: string; systemPrompt?: string; mcpConfigPath?: string }];
        try {
          const settings = useSettingsStore.getState().settings;
          const newId = useInstanceStore.getState().addInstance({
            cwd: config.cwd || '.',
            model: config.model || settings.defaultModel,
            dangerouslySkipPermissions: settings.defaultSkipPermissions,
            permissionMode: settings.defaultPermissionMode,
            allowedTools: [],
            maxBudget: 0,
            systemPrompt: config.systemPrompt || '',
            agentMode: settings.defaultAgentMode,
          }, config.name);
          useLayoutStore.getState().addPanel(newId);
          useChatStore.getState().initSession(newId);
          invoke('stream_configure', {
            id: newId,
            cwd: config.cwd || '.',
            model: config.model || settings.defaultModel || null,
            systemPrompt: config.systemPrompt || null,
            sessionId: null,
            mcpConfigPath: config.mcpConfigPath || null,
            permissionMode: settings.defaultPermissionMode || null,
            allowedTools: null,
            dangerouslySkipPermissions: settings.defaultSkipPermissions ?? false,
          }).then(() => {
            postToPlugin(createResponse(requestId, { instanceId: newId }));
          }).catch((err) => {
            postToPlugin(createResponse(requestId, null, String(err)));
          });
        } catch (err) {
          postToPlugin(createResponse(requestId, null, String(err)));
        }
        break;
      }
      case 'instances:remove': {
        const [removeId] = args as [string];
        try {
          invoke('stream_kill', { id: removeId }).catch(() => {});
          useChatStore.getState().destroySession(removeId);
          useInstanceStore.getState().removeInstance(removeId);
          useLayoutStore.getState().removePanel(removeId);
          postToPlugin(createResponse(requestId, { ok: true }));
        } catch (err) {
          postToPlugin(createResponse(requestId, null, String(err)));
        }
        break;
      }

      // ─── Chat Integration ──────────────────────────────────────────────
      case 'chat:send': {
        const [targetId, message] = args as [string, string];
        // Dispatch via event bus so chat panels can pick it up
        useEventBusStore.getState().dispatch('chat:send', {
          targetId,
          message,
          sourceId: instanceId,
          sourcePlugin: pluginName,
        }, instanceId);
        postToPlugin(createResponse(requestId, { ok: true }));
        break;
      }
      case 'chat:getHistory': {
        const [histTargetId, histLimit] = args as [string, number];
        const session = useChatStore.getState().sessions.get(histTargetId);
        if (!session) {
          postToPlugin(createResponse(requestId, []));
          break;
        }
        const limit = histLimit || 50;
        const history = session.messages.slice(-limit).map((msg) => {
          if ('text' in msg) {
            return { role: msg.role, text: msg.text, timestamp: msg.timestamp };
          }
          // Assistant message — extract text from blocks
          const text = (msg.blocks || [])
            .filter((b: { type: string }) => b.type === 'text')
            .map((b: { type: string; text?: string }) => b.text || '')
            .join('\n');
          return { role: msg.role, text };
        });
        postToPlugin(createResponse(requestId, history));
        break;
      }

      // ─── Plugin-to-Plugin Messaging ────────────────────────────────────
      case 'messaging:send': {
        const [targetId, data] = args as [string, unknown];
        useEventBusStore.getState().sendTo(targetId, {
          from: instanceId,
          fromPlugin: pluginName,
          data,
        }, instanceId);
        postToPlugin(createResponse(requestId, { ok: true }));
        break;
      }
      case 'messaging:broadcast': {
        const [channel, data] = args as [string, unknown];
        useEventBusStore.getState().broadcast(channel, data, instanceId);
        // No response needed for fire-and-forget broadcasts
        break;
      }

      // ─── UI Integration ────────────────────────────────────────────────
      case 'ui:setTitle': {
        const [title] = args as [string];
        usePluginStore.getState().setInstanceTitle(instanceId, title);
        break;
      }
      case 'ui:setIcon': {
        const [icon] = args as [string];
        usePluginStore.getState().setInstanceIcon(instanceId, icon);
        break;
      }
      case 'ui:setAccentColor': {
        const [color] = args as [string | null];
        usePluginStore.getState().setInstanceColor(instanceId, color);
        break;
      }
      case 'ui:setBadge': {
        const [count] = args as [number | null];
        usePluginStore.getState().setInstanceBadge(instanceId, count);
        break;
      }
      case 'ui:showNotification': {
        // TODO: Integrate with a toast/notification system
        const [message, type] = args as [string, string];
        console.log(`[Plugin:${pluginName}] ${type}: ${message}`);
        break;
      }

      // ─── File Access (Sandboxed) ──────────────────────────────────────
      case 'fs:readFile': {
        const [readPath] = args as [string];
        invoke('session_load_ady', { path: readPath })
          .then((content) => postToPlugin(createResponse(requestId, content)))
          .catch((err) => postToPlugin(createResponse(requestId, null, String(err))));
        break;
      }
      case 'fs:writeFile': {
        const [writePath, writeContent] = args as [string, string];
        invoke('session_save_ady', { path: writePath, content: writeContent })
          .then(() => postToPlugin(createResponse(requestId, { ok: true })))
          .catch((err) => postToPlugin(createResponse(requestId, null, String(err))));
        break;
      }
      case 'fs:readBinary': {
        // TODO: Implement via Tauri invoke
        postToPlugin(createResponse(requestId, null, 'fs:readBinary not yet implemented'));
        break;
      }
      case 'fs:writeBinary': {
        // TODO: Implement via Tauri invoke
        postToPlugin(createResponse(requestId, null, 'fs:writeBinary not yet implemented'));
        break;
      }
      case 'fs:listDir': {
        // TODO: Implement via Tauri invoke('plugin_list_dir', { pluginName, path })
        postToPlugin(createResponse(requestId, null, 'fs:listDir not yet implemented'));
        break;
      }
      case 'fs:mkdir': {
        // TODO: Implement via Tauri invoke
        postToPlugin(createResponse(requestId, null, 'fs:mkdir not yet implemented'));
        break;
      }
      case 'fs:delete': {
        // TODO: Implement via Tauri invoke
        postToPlugin(createResponse(requestId, null, 'fs:delete not yet implemented'));
        break;
      }
      case 'fs:exists': {
        // TODO: Implement via Tauri invoke
        postToPlugin(createResponse(requestId, null, 'fs:exists not yet implemented'));
        break;
      }

      // ─── Clipboard ────────────────────────────────────────────────────
      case 'clipboard:read': {
        navigator.clipboard.readText()
          .then((text) => postToPlugin(createResponse(requestId, text)))
          .catch((err) => postToPlugin(createResponse(requestId, null, String(err))));
        break;
      }
      case 'clipboard:write': {
        const [text] = args as [string];
        navigator.clipboard.writeText(text)
          .then(() => postToPlugin(createResponse(requestId, { ok: true })))
          .catch((err) => postToPlugin(createResponse(requestId, null, String(err))));
        break;
      }

      // ─── Event Emission ───────────────────────────────────────────────
      case 'event:emit': {
        const [event, data] = args as [string, unknown];
        useEventBusStore.getState().dispatch(event, data, instanceId);
        break;
      }

      // ─── Lifecycle ────────────────────────────────────────────────────
      case 'lifecycle:destroyAck': {
        // Plugin acknowledged destruction — nothing to do
        break;
      }

      default:
        console.warn(`[PluginBridge:${instanceId}] Unknown SDK method: ${method}`);
        postToPlugin(createResponse(requestId, null, `Unknown method: ${method}`));
    }
  }

  // ─── Message Listener ─────────────────────────────────────────────────────

  function onMessage(event: MessageEvent) {
    // Only handle messages from our specific iframe
    if (event.source !== iframe.contentWindow) return;
    if (!isPluginMessage(event.data)) return;

    const msg = event.data;

    if (msg.type === 'sdk:call') {
      handleCall(msg);
    } else if (msg.type === 'sdk:emit') {
      // Direct event emission
      const [eventName, data] = msg.args as [string, unknown];
      useEventBusStore.getState().dispatch(eventName, data, instanceId);
    } else if (msg.type === 'sdk:subscribe') {
      // Dynamic subscription (e.g. broadcast channels)
      const [eventName] = msg.args as [string];
      const unsub = bus.subscribe(eventName, instanceId, (data) => {
        postToPlugin({ type: SDK_EVENT, event: eventName, data });
      });
      unsubs.push(unsub);
    }
  }

  window.addEventListener('message', onMessage);

  // ─── Event Bus Subscriptions (forward incoming events to the iframe) ─────

  const unsubs: (() => void)[] = [];
  const bus = useEventBusStore.getState();

  // Direct messages from other plugins → plugin:message event in iframe
  unsubs.push(bus.subscribe('plugin:message', instanceId, (data) => {
    postToPlugin({ type: SDK_EVENT, event: 'plugin:message', data });
  }));

  // Chat messages → chat:message event in iframe
  unsubs.push(bus.subscribe('chat:message', instanceId, (data) => {
    postToPlugin({ type: SDK_EVENT, event: 'chat:message', data });
  }));

  // Chat responses → chat:response event in iframe
  unsubs.push(bus.subscribe('chat:response', instanceId, (data) => {
    postToPlugin({ type: SDK_EVENT, event: 'chat:response', data });
  }));

  // Chat result (turn complete) → chat:result event in iframe
  unsubs.push(bus.subscribe('chat:result', instanceId, (data) => {
    postToPlugin({ type: SDK_EVENT, event: 'chat:result', data });
  }));

  // Instance list changes → instance:list event in iframe
  unsubs.push(bus.subscribe('instance:list', instanceId, (data) => {
    postToPlugin({ type: SDK_EVENT, event: 'instance:list', data });
  }));

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    sendInit() {
      const pluginInstance = usePluginStore.getState().instances.get(instanceId);
      const groupId = useGroupStore.getState().getCurrentGroupId();
      postToPlugin({
        type: SDK_INIT,
        data: {
          instanceId,
          pluginName,
          groupId,
          theme: getCurrentTheme(),
          title: pluginInstance?.title ?? pluginName,
        },
      });
    },

    sendDestroy() {
      return new Promise<void>((resolve) => {
        postToPlugin({ type: SDK_DESTROY });
        // Give the plugin 500ms grace period to save state
        setTimeout(resolve, 500);
      });
    },

    destroy() {
      destroyed = true;
      window.removeEventListener('message', onMessage);
      // Clean up bridge-owned event bus subscriptions
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
      // Clean up any remaining event bus subscriptions for this instance
      useEventBusStore.getState().cleanupInstance(instanceId);
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lookupInstance(targetId: string): InstanceInfo | null {
  // Check instanceStore (chat/terminal/computer instances)
  const inst = useInstanceStore.getState().instances.get(targetId);
  if (inst) {
    const panelType = useLayoutStore.getState().panelTypes[targetId];
    let type: InstanceInfo['type'];
    switch (panelType) {
      case 'computer': type = 'computer'; break;
      case 'llm': type = 'llm'; break;
      default: type = 'chat'; break;
    }
    return { id: targetId, name: inst.name, type, groupId: null, cwd: inst.config.cwd };
  }

  // Check pluginStore
  const pi = usePluginStore.getState().instances.get(targetId);
  if (pi) {
    return { id: targetId, name: pi.title, type: 'plugin', pluginName: pi.pluginName, groupId: null, icon: pi.icon };
  }

  // Check groupStore
  const group = useGroupStore.getState().groups.get(targetId);
  if (group) {
    return { id: targetId, name: group.name, type: 'group', groupId: group.parentId };
  }

  return null;
}

function buildInstanceList(): InstanceInfo[] {
  const result: InstanceInfo[] = [];

  // Chat/terminal/computer instances from instanceStore
  const instances = useInstanceStore.getState().instances;
  const panelTypes = useLayoutStore.getState().panelTypes;
  const chatSessions = useChatStore.getState().sessions;

  for (const [id, inst] of instances) {
    const panelType = panelTypes[id];
    let type: InstanceInfo['type'];
    switch (panelType) {
      case 'computer': type = 'computer'; break;
      case 'llm': type = 'llm'; break;
      default: type = 'chat'; break;
    }
    result.push({
      id,
      name: inst.name,
      type,
      groupId: null, // TODO: get from groupStore once panels track their group
      hasSession: chatSessions.has(id),
      cwd: inst.config.cwd,
    });
  }

  // Plugin instances
  const pluginInstances = usePluginStore.getState().instances;
  for (const [id, pi] of pluginInstances) {
    result.push({
      id,
      name: pi.title,
      type: 'plugin',
      pluginName: pi.pluginName,
      groupId: null, // TODO: get from groupStore
      icon: pi.icon,
    });
  }

  // Groups
  const groups = useGroupStore.getState().groups;
  for (const [id, group] of groups) {
    result.push({
      id,
      name: group.name,
      type: 'group',
      groupId: group.parentId,
    });
  }

  return result;
}

function getCurrentTheme() {
  // Read CSS custom properties from the document root to build a theme object
  const style = getComputedStyle(document.documentElement);
  const isDark = style.getPropertyValue('--bg-primary').trim().startsWith('#1') ||
    style.getPropertyValue('--bg-primary').trim().startsWith('#0') ||
    style.getPropertyValue('--bg-primary').trim().startsWith('rgb(1') ||
    style.getPropertyValue('--bg-primary').trim().startsWith('rgb(0');

  return {
    name: isDark ? 'dark' : 'light',
    isDark,
    colors: {
      bgPrimary: style.getPropertyValue('--bg-primary').trim(),
      bgSurface: style.getPropertyValue('--bg-surface').trim(),
      bgElevated: style.getPropertyValue('--bg-elevated').trim(),
      textPrimary: style.getPropertyValue('--text-primary').trim(),
      textMuted: style.getPropertyValue('--text-muted').trim(),
      accent: style.getPropertyValue('--accent').trim(),
      border: style.getPropertyValue('--border').trim(),
    },
  };
}

// Re-export the event type constant for PluginPanel
export { SDK_EVENT };
