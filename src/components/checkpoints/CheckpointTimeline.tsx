import { useEffect, useState } from 'react';
import { useCheckpointStore } from '../../store/checkpointStore';
import type { Checkpoint } from '../../types/checkpoint';
import { GitBranch, Plus, RotateCcw, Trash2 } from 'lucide-react';

interface CheckpointTimelineProps {
  instanceId: string;
}

const BRANCH_COLORS: Record<string, string> = {};
const COLOR_PALETTE = [
  'var(--accent)', 'var(--success)', 'var(--warning)', 'var(--error)',
  '#c084fc', '#f472b6', '#22d3ee', '#fb923c',
];

function getBranchColor(branch: string): string {
  if (!BRANCH_COLORS[branch]) {
    const idx = Object.keys(BRANCH_COLORS).length % COLOR_PALETTE.length;
    BRANCH_COLORS[branch] = COLOR_PALETTE[idx];
  }
  return BRANCH_COLORS[branch];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function CheckpointTimeline({ instanceId }: CheckpointTimelineProps) {
  const { checkpoints, loading, fetchCheckpoints, getCheckpoint, createCheckpoint, deleteCheckpoint } = useCheckpointStore();
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    fetchCheckpoints(instanceId);
  }, [instanceId, fetchCheckpoints]);

  const items: Checkpoint[] = checkpoints.get(instanceId) ?? [];

  const handleRestore = async (id: number) => {
    setRestoring(id);
    try {
      await getCheckpoint(id);
    } finally {
      setRestoring(null);
    }
  };

  const handleCreate = () => {
    createCheckpoint(instanceId, '', 'Manual checkpoint', '[]');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Checkpoints</span>
        <button className="btn btn-primary btn-sm" onClick={handleCreate} style={{ gap: 4, display: 'flex', alignItems: 'center' }}>
          <Plus size={14} /> Create
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loading && items.length === 0 && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>Loading...</p>
        )}
        {!loading && items.length === 0 && (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 13 }}>No checkpoints yet.</p>
        )}

        <div style={{ position: 'relative', paddingLeft: 24 }}>
          {/* Vertical line */}
          {items.length > 1 && (
            <div style={{
              position: 'absolute', left: 7, top: 8, bottom: 8, width: 2,
              background: 'var(--border)',
            }} />
          )}

          {items.map((cp) => {
            const color = getBranchColor(cp.branch_name);
            return (
              <div key={cp.id} style={{ position: 'relative', marginBottom: 16 }}>
                {/* Node dot */}
                <div style={{
                  position: 'absolute', left: -24, top: 4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--bg-surface)', border: `3px solid ${color}`,
                  zIndex: 1,
                }} />

                <div style={{
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{cp.label}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn btn-sm btn-secondary"
                        title="Restore"
                        disabled={restoring === cp.id}
                        onClick={() => handleRestore(cp.id)}
                        style={{ padding: '2px 6px' }}
                      >
                        <RotateCcw size={12} />
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        title="Delete"
                        onClick={() => deleteCheckpoint(cp.id, instanceId)}
                        style={{ padding: '2px 6px' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span>{formatTime(cp.created_at)}</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '1px 6px', borderRadius: 10,
                      background: `${color}22`, color,
                      fontSize: 10, fontWeight: 600,
                    }}>
                      <GitBranch size={10} /> {cp.branch_name}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
