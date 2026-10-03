import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useUsageStore } from '../store/usageStore';
import { useSettingsStore } from '../store/settingsStore';
import type { UsageInfo } from '../types/ipc';

/** Which structured source knows a panel's usage. Claude: its own session file.
 *  Codex and Antigravity: the turns Tessera recorded in Activity (tokens only,
 *  no list price). OpenCode and API chats record nothing, and Antigravity
 *  terminals report nothing, so they are left out rather than shown as zero. */
export function usageSource(instance: { config: { agentProvider?: string; panelView?: string; cwd: string; llmConfig?: unknown }; claudeSessionId?: string; codexThreadId?: string; antigravityConversationId?: string }): { command: string; args: Record<string, string>; provider: string } | null {
  if (instance.config.llmConfig) return null;
  const provider = instance.config.agentProvider ?? 'claude';
  if (provider === 'claude') return instance.claudeSessionId ? { command: 'session_parse_usage', args: { sessionId: instance.claudeSessionId, projectPath: instance.config.cwd }, provider } : null;
  if (provider === 'codex') return instance.codexThreadId ? { command: 'activity_session_usage', args: { provider, sessionId: instance.codexThreadId }, provider } : null;
  if (provider === 'antigravity' && instance.config.panelView !== 'terminal') return instance.antigravityConversationId ? { command: 'activity_session_usage', args: { provider, sessionId: instance.antigravityConversationId }, provider } : null;
  return null;
}

export function useUsagePolling() {
  // Reactive: restart the poller whenever the interval setting changes
  const interval = useSettingsStore((s) => s.settings.usagePollingInterval);

  useEffect(() => {
    const pollUsage = async () => {
      for (const [id, instance] of useInstanceStore.getState().instances) {
        if (instance.status !== 'running') continue;
        const source = usageSource(instance);
        if (!source) continue;
        try {
          const usage = await invoke<UsageInfo>(source.command, source.args);
          if (usage) useUsageStore.getState().setUsage(id, { ...usage, provider: source.provider });
        } catch {
          // Silently skip failed usage polls
        }
      }
    };

    // Initial poll after a delay
    const initialTimeout = setTimeout(pollUsage, 5000);

    // Regular polling
    const timer = setInterval(pollUsage, interval);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(timer);
    };
  }, [interval]);
}
