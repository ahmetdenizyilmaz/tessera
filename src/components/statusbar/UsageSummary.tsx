import React from 'react';
import { useUsageStore } from '../../store/usageStore';

interface UsageSummaryProps {
  onUsageClick?: () => void;
}

export const UsageSummary: React.FC<UsageSummaryProps> = ({ onUsageClick }) => {
  const usage = useUsageStore((s) => s.usage);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  usage.forEach((info) => {
    totalInput += info.inputTokens;
    totalOutput += info.outputTokens;
    totalCost += info.totalCostUsd;
  });

  if (totalInput === 0 && totalOutput === 0) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>No usage data</span>;
  }

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div
      className="usage-summary"
      onClick={onUsageClick}
      title={onUsageClick ? 'Click to view usage details' : undefined}
      style={onUsageClick ? { cursor: 'pointer' } : undefined}
    >
      <span>
        Tokens: {formatTokens(totalInput)} in / {formatTokens(totalOutput)} out
      </span>
      {totalCost > 0 && (
        <span className="usage-cost">
          ${totalCost.toFixed(4)}
        </span>
      )}
    </div>
  );
};
