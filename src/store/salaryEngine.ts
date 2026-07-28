import { useEffect } from 'react';
import type { LlmProvider } from '../types/instance';
import type { WorkerActivity } from '../types/office';
import { useOfficeGameStore } from './officeGameStore';
import { useInstanceStore } from './instanceStore';

const PROVIDER_BASE_RATES: Record<LlmProvider, number> = {
  claude: 22.5,
  openai: 12,
  gemini: 10,
  ollama: 8,
  lmstudio: 8,
};

const MODEL_MULTIPLIERS: Record<string, number> = {
  'fable': 2.0,
  'claude-fable-5': 2.0,
  'opus': 1.5,
  'claude-opus-5': 1.5,
  'sonnet': 1.0,
  'claude-sonnet-5': 1.0,
  'haiku': 0.7,
  'claude-opus-4-6': 1.5,
  'claude-opus-4-5-20250620': 1.5,
  'gpt-4o': 1.5,
  'gpt-4-turbo': 1.5,
  'gemini-pro': 1.5,
  'claude-sonnet-4-6': 1.0,
  'claude-sonnet-4-5-20250514': 1.0,
  'gpt-4o-mini': 1.0,
  'gemini-flash': 1.0,
  'claude-haiku-4-5-20251001': 0.7,
  'gpt-3.5-turbo': 0.7,
};

const WORKING_ACTIVITIES: Set<WorkerActivity> = new Set([
  'thinking', 'responding', 'reading_file', 'editing_file', 'writing_file',
  'running_command', 'searching_files', 'searching_web', 'managing_todos',
  'awaiting_permission', 'using_tool',
]);

export function isWorking(activity: WorkerActivity): boolean {
  return WORKING_ACTIVITIES.has(activity);
}

export function getSalaryRate(provider: LlmProvider, model: string): number {
  const base = PROVIDER_BASE_RATES[provider] ?? 10;
  const multiplier = MODEL_MULTIPLIERS[model] ?? 1.0;
  return base * multiplier;
}

export function useSalaryEngine(): void {
  useEffect(() => {
    const interval = setInterval(() => {
      const workers = useOfficeGameStore.getState().workers;
      const instances = useInstanceStore.getState().instances;
      let totalSalary = 0;

      for (const [instanceId, worker] of Object.entries(workers)) {
        if (!isWorking(worker.activity)) continue;

        const instance = instances.get(instanceId);
        if (!instance) continue;

        const provider = instance.config.llmConfig?.provider ?? 'claude';
        const model = instance.config.llmConfig?.model ?? instance.config.model;
        const ratePerMinute = getSalaryRate(provider, model);
        const ratePerSecond = ratePerMinute / 60;
        totalSalary += ratePerSecond;
      }

      if (totalSalary > 0) {
        useOfficeGameStore.getState().earnSalary(totalSalary);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);
}
