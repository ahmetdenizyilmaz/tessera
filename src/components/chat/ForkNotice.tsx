import { GitFork } from 'lucide-react';
import { useInstanceStore } from '../../store/instanceStore';

/**
 * Shown in a forked panel until its first message goes out: the inherited
 * conversation is visible above but has not reached the agent yet.
 */
export function ForkNotice({ instanceId }: { instanceId: string }) {
  const fork = useInstanceStore((s) => s.instances.get(instanceId)?.config.fork);
  if (!fork?.pending) return null;
  return (
    <div className="fork-notice" role="status">
      <GitFork size={12} />
      <span>
        Forked from <strong>{fork.sourceName}</strong> · the earlier conversation ({fork.transcript.length} message
        {fork.transcript.length === 1 ? '' : 's'}) is attached to your first message.
      </span>
    </div>
  );
}
