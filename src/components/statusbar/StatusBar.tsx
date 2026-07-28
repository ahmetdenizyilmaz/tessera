import React from 'react';
import { SystemResources } from './SystemResources';
import { UsageSummary } from './UsageSummary';

interface StatusBarProps {
  onNewInstance?: () => void;
  onUsageClick?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({ onNewInstance, onUsageClick }) => {
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {onNewInstance && (
          <button
            className="status-bar-add-btn"
            onClick={onNewInstance}
            title="New instance (Ctrl+N)"
          >
            +
          </button>
        )}
        <SystemResources />
      </div>
      <UsageSummary onUsageClick={onUsageClick} />
    </div>
  );
};
