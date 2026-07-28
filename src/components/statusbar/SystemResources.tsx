import React from 'react';
import { useSystemStore } from '../../store/systemStore';

function getLevel(percent: number): string {
  if (percent < 60) return 'low';
  if (percent < 85) return 'medium';
  return 'high';
}

function formatGb(gb: number): string {
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = gb * 1024;
  return `${mb.toFixed(0)} MB`;
}

export const SystemResources: React.FC = () => {
  const cpuPercent = useSystemStore((s) => s.cpuPercent);
  const memoryUsedGb = useSystemStore((s) => s.memoryUsedGb);
  const memoryTotalGb = useSystemStore((s) => s.memoryTotalGb);
  const memoryPercent = useSystemStore((s) => s.memoryPercent);

  // Show percentage + used/total for clarity. Before data loads (total=0),
  // just show the percentage to avoid a confusing "0 MB / 0 MB" display.
  const ramLabel = memoryTotalGb > 0
    ? `${memoryPercent.toFixed(0)}% (${formatGb(memoryUsedGb)} / ${formatGb(memoryTotalGb)})`
    : `${memoryPercent.toFixed(0)}%`;

  return (
    <>
      <div className="resource-bar">
        <span className="resource-label">CPU</span>
        <div className="resource-track">
          <div
            className={`resource-fill ${getLevel(cpuPercent)}`}
            style={{ width: `${Math.min(100, cpuPercent)}%` }}
          />
        </div>
        <span className="resource-value">{cpuPercent.toFixed(0)}%</span>
      </div>

      <div className="resource-bar">
        <span className="resource-label">RAM</span>
        <div className="resource-track">
          <div
            className={`resource-fill ${getLevel(memoryPercent)}`}
            style={{ width: `${Math.min(100, memoryPercent)}%` }}
          />
        </div>
        <span className="resource-value">{ramLabel}</span>
      </div>
    </>
  );
};
