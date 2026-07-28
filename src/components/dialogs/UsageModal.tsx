import React from 'react';
import { useUsageStore } from '../../store/usageStore';
import { useInstanceStore } from '../../store/instanceStore';

interface UsageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UsageModal: React.FC<UsageModalProps> = ({ isOpen, onClose }) => {
  const usage = useUsageStore((s) => s.usage);
  const instances = useInstanceStore((s) => s.instances);

  if (!isOpen) return null;

  const entries = Array.from(usage.entries()).map(([id, info]) => {
    const instance = instances.get(id);
    return { id, name: instance?.name ?? id, color: instance?.color ?? '#4a9eff', ...info };
  });

  const totals = entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      totalCostUsd: acc.totalCostUsd + e.totalCostUsd,
    }),
    { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
  );

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  };

  const formatCost = (n: number) => '$' + n.toFixed(4);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 500 }}>
        <h2>Usage Information</h2>

        {entries.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            No usage data available yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr repeat(3, auto)',
                  gap: 16,
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                  <span className="truncate">{e.name}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                  In: {formatTokens(e.inputTokens)}
                </div>
                <div style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                  Out: {formatTokens(e.outputTokens)}
                </div>
                <div style={{ fontWeight: 600, textAlign: 'right' }}>
                  {formatCost(e.totalCostUsd)}
                </div>
              </div>
            ))}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr repeat(3, auto)',
                gap: 16,
                alignItems: 'center',
                padding: '10px 12px',
                borderTop: '1px solid var(--border)',
                marginTop: 4,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <div>Total</div>
              <div style={{ textAlign: 'right' }}>In: {formatTokens(totals.inputTokens)}</div>
              <div style={{ textAlign: 'right' }}>Out: {formatTokens(totals.outputTokens)}</div>
              <div style={{ textAlign: 'right', color: 'var(--accent)' }}>{formatCost(totals.totalCostUsd)}</div>
            </div>
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
