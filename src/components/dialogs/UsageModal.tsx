import React from 'react';
import { useUsageStore } from '../../store/usageStore';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { MAGNITUDE, formatTokens, formatCost } from '../analytics/chartTheme';

interface UsageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Quick live-session usage popup. Shares the dashboard's design language:
 *  ink values, tabular numeric columns, single-hue magnitude bars. The full
 *  history lives in the analytics widget — the footer jumps there. */
export const UsageModal: React.FC<UsageModalProps> = ({ isOpen, onClose }) => {
  const usage = useUsageStore((s) => s.usage);
  const instances = useInstanceStore((s) => s.instances);
  const addWidgetPanel = useLayoutStore((s) => s.addWidgetPanel);

  if (!isOpen) return null;

  const entries = Array.from(usage.entries())
    .map(([id, info]) => {
      const instance = instances.get(id);
      return { id, name: instance?.name ?? id, color: instance?.color ?? '#4a9eff', ...info };
    })
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  const totals = entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      totalCostUsd: acc.totalCostUsd + e.totalCostUsd,
    }),
    { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 },
  );
  const maxCost = entries[0]?.totalCostUsd ?? 0;

  const numCol: React.CSSProperties = {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text-secondary)',
    fontSize: 13,
  };

  const openAnalytics = () => {
    addWidgetPanel('analytics');
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 520 }}>
        <h2>Session usage</h2>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '-6px 0 12px' }}>
          Live totals for the panels in this workspace
        </div>

        {entries.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            No usage data available yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 72px 72px 88px',
                gap: 12,
                padding: '0 12px 6px',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}
            >
              <div>Session</div>
              <div style={{ textAlign: 'right' }}>Input</div>
              <div style={{ textAlign: 'right' }}>Output</div>
              <div style={{ textAlign: 'right' }}>Cost</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((e) => {
                const share = maxCost > 0 ? Math.max(2, (e.totalCostUsd / maxCost) * 100) : 0;
                return (
                  <div
                    key={e.id}
                    style={{
                      padding: '8px 12px 6px',
                      background: 'var(--bg-elevated)',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 72px 72px 88px',
                        gap: 12,
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                        <span className="truncate" style={{ fontSize: 13, color: 'var(--text-primary)' }}>{e.name}</span>
                      </div>
                      <div style={numCol}>{formatTokens(e.inputTokens)}</div>
                      <div style={numCol}>{formatTokens(e.outputTokens)}</div>
                      <div style={{ ...numCol, color: 'var(--text-primary)', fontWeight: 600 }}>
                        {formatCost(e.totalCostUsd)}
                      </div>
                    </div>
                    {/* cost share vs the most expensive session — one hue, data-end rounded */}
                    <div style={{ height: 3, marginTop: 6, background: 'rgba(61, 135, 224, 0.12)', borderRadius: '0 2px 2px 0' }}>
                      <div style={{ height: '100%', width: `${share}%`, background: MAGNITUDE, borderRadius: '0 2px 2px 0' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 72px 72px 88px',
                gap: 12,
                alignItems: 'center',
                padding: '10px 12px 0',
                borderTop: '1px solid var(--border)',
                marginTop: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Total</div>
              <div style={{ ...numCol, fontWeight: 600 }}>{formatTokens(totals.inputTokens)}</div>
              <div style={{ ...numCol, fontWeight: 600 }}>{formatTokens(totals.outputTokens)}</div>
              <div style={{ ...numCol, color: 'var(--text-primary)', fontWeight: 700 }}>
                {formatCost(totals.totalCostUsd)}
              </div>
            </div>
          </div>
        )}

        <div className="dialog-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" onClick={openAnalytics}>
            Open analytics
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
