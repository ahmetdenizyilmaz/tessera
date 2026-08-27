import React from 'react';
import { formatTokens } from './chartTheme';

export interface SummaryDeltas {
  /** Percent change vs the previous equal-length period; null = no baseline. */
  cost: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  sessions: number | null;
}

interface SummaryCardsProps {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionsCount: number;
  deltas?: SummaryDeltas;
}

/** Signed delta chip. Direction color only for cost (up = spending more =
 *  serious); the rest stay neutral — more tokens isn't good or bad. Sign and
 *  arrow carry the direction, so color is never the only channel. */
function DeltaChip({ pct, upIsBad }: { pct: number | null; upIsBad?: boolean }) {
  if (pct === null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const color = upIsBad ? (up ? 'var(--error)' : 'var(--success)') : 'var(--text-muted)';
  return (
    <span
      title="vs previous period"
      style={{ fontSize: 10, fontWeight: 600, color, whiteSpace: 'nowrap' }}
    >
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export const AnalyticsSummaryCards: React.FC<SummaryCardsProps> = ({
  totalCost,
  totalInputTokens,
  totalOutputTokens,
  sessionsCount,
  deltas,
}) => {
  const cards = [
    {
      label: 'Total cost',
      value: `$${totalCost.toFixed(2)}`,
      delta: deltas ? <DeltaChip pct={deltas.cost} upIsBad /> : null,
    },
    {
      label: 'Input tokens',
      value: formatTokens(totalInputTokens),
      delta: deltas ? <DeltaChip pct={deltas.inputTokens} /> : null,
    },
    {
      label: 'Output tokens',
      value: formatTokens(totalOutputTokens),
      delta: deltas ? <DeltaChip pct={deltas.outputTokens} /> : null,
    },
    {
      label: 'Sessions',
      value: sessionsCount.toString(),
      delta: deltas ? <DeltaChip pct={deltas.sessions} /> : null,
    },
  ];

  return (
    <div className="analytics-summary-cards">
      {cards.map((card) => (
        <div key={card.label} className="analytics-summary-card">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <div className="analytics-summary-card__value">{card.value}</div>
            {card.delta}
          </div>
          <div className="analytics-summary-card__label">{card.label}</div>
        </div>
      ))}
    </div>
  );
};
