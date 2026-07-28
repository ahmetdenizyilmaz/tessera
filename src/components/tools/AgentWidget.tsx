import React from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

const AgentWidget: React.FC<ToolWidgetProps> = ({ name, input, result }) => {
  const description = (input.description as string) ?? '';
  const prompt = (input.prompt as string) ?? '';
  const mode = (input.mode as string) ?? '';

  return (
    <div className="tool-widget">
      <div className="tool-widget__header">
        <span className="tool-widget__icon" style={{ fontSize: 13 }}>&#x1F916;</span>
        <span className="tool-widget__name">{name}</span>
        {mode && <span className="tool-widget__badge">{mode}</span>}
      </div>
      {description && (
        <div className="tool-widget__detail">{description}</div>
      )}
      {prompt && (
        <div className="tool-widget__body">
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxHeight: 100, overflowY: 'auto' }}>
            {prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt}
          </div>
        </div>
      )}
      {result && (
        <div className="tool-widget__body">
          <pre className="tool-widget__pre" style={{ maxHeight: 150, overflowY: 'auto' }}>{result}</pre>
        </div>
      )}
    </div>
  );
};

export default AgentWidget;
