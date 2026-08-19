import React from 'react';
import { SystemResources } from './SystemResources';
import { UsageSummary } from './UsageSummary';
import { BUILD_LABEL, buildDateLabel } from '../../lib/buildInfo';

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
      <div className="status-bar-right">
        <UsageSummary onUsageClick={onUsageClick} />
        <span
          className="status-bar-version"
          title={`Build ${buildDateLabel()} — compare the hash against the latest commit to confirm you're on the live build`}
        >
          {BUILD_LABEL}
        </span>
      </div>
    </div>
  );
};
