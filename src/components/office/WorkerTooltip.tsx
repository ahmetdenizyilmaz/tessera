import { useInstanceStore } from '../../store/instanceStore';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { ACTIVITY_LABELS } from '../../engine/SpriteManager';
import { getSalaryRate, isWorking } from '../../store/salaryEngine';
import type { WorkerActivity } from '../../types/office';

interface WorkerTooltipProps {
  instanceId: string;
  screenX: number;
  screenY: number;
}

export function WorkerTooltip({ instanceId, screenX, screenY }: WorkerTooltipProps) {
  const instance = useInstanceStore(s => s.instances.get(instanceId));
  const worker = useOfficeGameStore(s => s.workers[instanceId]);

  if (!instance || !worker) return null;

  const provider = instance.config.llmConfig?.provider ?? 'claude';
  const model = instance.config.llmConfig?.model ?? instance.config.model;
  const activityLabel = ACTIVITY_LABELS[worker.activity as WorkerActivity] ?? worker.activity;
  const rate = getSalaryRate(provider, model);
  const working = isWorking(worker.activity);

  const PROVIDER_LABELS: Record<string, string> = {
    claude: 'Claude Code',
    anthropic: 'Claude (API)',
    openai: 'OpenAI',
    gemini: 'Gemini',
    ollama: 'Ollama',
    lmstudio: 'LM Studio',
  };

  return (
    <div
      className="worker-tooltip"
      style={{
        left: screenX + 16,
        top: screenY - 10,
      }}
    >
      <div className="worker-tooltip__name">{instance.name}</div>
      <div className="worker-tooltip__provider">
        {PROVIDER_LABELS[provider] ?? provider} - {model}
      </div>
      <div className="worker-tooltip__activity">
        <span className={`worker-tooltip__status worker-tooltip__status--${working ? 'working' : 'idle'}`} />
        {activityLabel}
      </div>
      {working && (
        <div className="worker-tooltip__rate">
          +{rate.toFixed(1)} coins/min
        </div>
      )}
    </div>
  );
}
