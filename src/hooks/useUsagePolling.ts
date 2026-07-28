import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useInstanceStore } from '../store/instanceStore';
import { useUsageStore } from '../store/usageStore';
import { useSettingsStore } from '../store/settingsStore';
import type { UsageInfo } from '../types/ipc';

export function useUsagePolling() {
  useEffect(() => {
    const interval = useSettingsStore.getState().settings.usagePollingInterval;

    const pollUsage = async () => {
      const instances = useInstanceStore.getState().instances;

      for (const [id, instance] of instances) {
        if (instance.status !== 'running' || !instance.claudeSessionId) continue;

        try {
          const usage = await invoke<UsageInfo>('session_parse_usage', {
            sessionId: instance.claudeSessionId,
            projectPath: instance.config.cwd,
          });
          if (usage) {
            useUsageStore.getState().setUsage(id, usage);
          }
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
  }, []);
}
