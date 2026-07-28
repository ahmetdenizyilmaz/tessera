import React from 'react';

interface SummaryCardsProps {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionsCount: number;
}

export const AnalyticsSummaryCards: React.FC<SummaryCardsProps> = ({
  totalCost,
  totalInputTokens,
  totalOutputTokens,
  sessionsCount,
}) => {
  const cards = [
    { label: 'Total Cost', value: `$${totalCost.toFixed(2)}`, color: 'var(--warning)' },
    { label: 'Input Tokens', value: formatTokens(totalInputTokens), color: 'var(--accent)' },
    { label: 'Output Tokens', value: formatTokens(totalOutputTokens), color: 'var(--success)' },
    { label: 'Sessions', value: sessionsCount.toString(), color: 'var(--text-primary)' },
  ];

  return (
    <div className="analytics-summary-cards">
      {cards.map((card) => (
        <div key={card.label} className="analytics-summary-card">
          <div className="analytics-summary-card__value" style={{ color: card.color }}>{card.value}</div>
          <div className="analytics-summary-card__label">{card.label}</div>
        </div>
      ))}
    </div>
  );
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
