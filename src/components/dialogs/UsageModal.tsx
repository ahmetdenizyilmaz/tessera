import React from 'react';
import { useUsageStore } from '../../store/usageStore';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { MAGNITUDE, formatTokens, formatCost } from '../analytics/chartTheme';
import { providerName } from '../../lib/activityGraph';

interface UsageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COLUMNS = '1fr 64px 64px 64px 64px 84px';

/** Quick live-session usage popup. Shares the dashboard's design language:
 *  ink values, tabular numeric columns, single-hue magnitude bars. The full
 *  history lives in the analytics widget — the footer jumps there. */
export const UsageModal: React.FC<UsageModalProps> = ({ isOpen, onClose }) => {
  const usage = useUsageStore((s) => s.usage);
  const instances = useInstanceStore((s) => s.instances);
  const addWidgetPanel = useLayoutStore((s) => s.addWidgetPanel);

  if (!isOpen) return null;

  const entries = Array.from(usage.entries())
    .filter(([id]) => instances.has(id))
    .map(([id, info]) => {
      const instance = instances.get(id)!;
      const provider = info.provider ?? instance.config.agentProvider ?? 'claude';
      const total = info.inputTokens + info.outputTokens + info.cacheReadTokens + info.cacheWriteTokens;
      // Claude's old poller never set `priced`; a Claude session with cost is priced.
      const priced = info.priced ?? (provider === 'claude' && info.totalCostUsd > 0);
      return { id, name: instance.name, color: instance.color, provider, total, priced, ...info };
    })
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd || b.total - a.total);

  const totals = entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + e.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + e.cacheWriteTokens,
      totalCostUsd: acc.totalCostUsd + e.totalCostUsd,
      unpriced: acc.unpriced + (e.priced ? 0 : e.total),
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCostUsd: 0, unpriced: 0 },
  );
  const maxShare = Math.max(0, ...entries.map((e) => (e.totalCostUsd > 0 ? e.totalCostUsd : 0)));
  const maxTokens = Math.max(0, ...entries.map((e) => e.total));

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
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 640 }}>
        <div className="dialog-header">
          <div>
            <h3 className="dialog-title">Session usage</h3>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Live totals for the panels in this workspace
            </div>
          </div>
          <button className="dialog-close-btn" onClick={onClose}>{'×'}</button>
        </div>

        <div className="dialog-body">
        {entries.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>
            No usage data yet. Claude, Codex and Antigravity chat panels appear here after their first turn.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 10, padding: '0 12px 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600 }}>
              <div>Session</div>
              <div style={{ textAlign: 'right' }}>Input</div>
              <div style={{ textAlign: 'right' }}>Output</div>
              <div style={{ textAlign: 'right' }} title="Cache create + cache read">Cache</div>
              <div style={{ textAlign: 'right' }}>Total</div>
              <div style={{ textAlign: 'right' }}>Cost</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {entries.map((e) => {
                // Share of the costliest session; sessions without a price show their token share instead.
                const share = e.priced && maxShare > 0 ? (e.totalCostUsd / maxShare) * 100 : maxTokens > 0 ? (e.total / maxTokens) * 100 : 0;
                return (
                  <div key={e.id} data-usage-session={e.name} style={{ padding: '8px 12px 6px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 10, alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: e.color, flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div className="truncate" style={{ fontSize: 13, color: 'var(--text-primary)' }}>{e.name}</div>
                          <div className="truncate" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{providerName(e.provider)}{e.models?.length ? ` · ${e.models.map((m) => m.replace(/^claude-/, '')).join(', ')}` : ''}</div>
                        </div>
                      </div>
                      <div style={numCol}>{formatTokens(e.inputTokens)}</div>
                      <div style={numCol}>{formatTokens(e.outputTokens)}</div>
                      <div style={numCol} title={`${formatTokens(e.cacheWriteTokens)} created · ${formatTokens(e.cacheReadTokens)} read`}>{formatTokens(e.cacheWriteTokens + e.cacheReadTokens)}</div>
                      <div style={numCol}>{formatTokens(e.total)}</div>
                      <div style={{ ...numCol, color: e.priced ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: 600 }} title={e.priced ? 'At Anthropic list prices' : e.provider === 'claude' ? 'No list price for this model' : `${providerName(e.provider)} runs on its own subscription and reports no price`}>
                        {e.priced ? formatCost(e.totalCostUsd) : '—'}
                      </div>
                    </div>
                    {share > 0 && (
                      <div style={{ height: 3, marginTop: 6, background: 'rgba(61, 135, 224, 0.12)', borderRadius: '0 2px 2px 0' }}>
                        <div style={{ height: '100%', width: `${Math.max(2, share)}%`, background: MAGNITUDE, borderRadius: '0 2px 2px 0', opacity: e.priced ? 1 : 0.45 }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 10, alignItems: 'center', padding: '10px 12px 0', borderTop: '1px solid var(--border)', marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Total</div>
              <div style={{ ...numCol, fontWeight: 600 }}>{formatTokens(totals.inputTokens)}</div>
              <div style={{ ...numCol, fontWeight: 600 }}>{formatTokens(totals.outputTokens)}</div>
              <div style={{ ...numCol, fontWeight: 600 }}>{formatTokens(totals.cacheWriteTokens + totals.cacheReadTokens)}</div>
              <div style={{ ...numCol, fontWeight: 600 }}>{formatTokens(totals.inputTokens + totals.outputTokens + totals.cacheWriteTokens + totals.cacheReadTokens)}</div>
              <div style={{ ...numCol, color: 'var(--text-primary)', fontWeight: 700 }} title={totals.unpriced > 0 ? `${formatTokens(totals.unpriced)} tokens have no price and are not included` : undefined}>
                {formatCost(totals.totalCostUsd)}{totals.unpriced > 0 ? '*' : ''}
              </div>
            </div>
            <p style={{ margin: '10px 12px 0', fontSize: 11, color: 'var(--text-muted)' }}>
              Costs are what these tokens would cost at Anthropic list prices; a subscription is not billed per token.{totals.unpriced > 0 ? ' * Sessions marked — have no list price and are not included.' : ''}
            </p>
          </div>
        )}
        </div>

        <div className="dialog-footer">
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
