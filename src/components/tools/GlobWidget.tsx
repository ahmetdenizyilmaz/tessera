import React, { useState } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

const GlobWidget: React.FC<ToolWidgetProps> = ({ input, result }) => {
  const [expanded, setExpanded] = useState(false);
  const pattern = (input.pattern as string) ?? '';
  const path = (input.path as string) ?? '';

  const files = result ? result.split('\n').filter((l) => l.trim()) : [];

  return (
    <div className="tool-widget tool-widget--glob">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#128269;</span>
        <span className="tool-widget__label">Glob</span>
        <code className="tool-widget__pattern">{pattern}</code>
        {files.length > 0 && <span className="tool-widget__meta">{files.length} files</span>}
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          {path && <div className="tool-widget__description">in {path}</div>}
          {files.length > 0 ? (
            <ul className="tool-widget__file-list">
              {files.map((f, i) => (
                <li key={i} className="tool-widget__file-item">{f}</li>
              ))}
            </ul>
          ) : result == null ? (
            <div className="tool-widget__loading">Searching...</div>
          ) : (
            <div className="tool-widget__empty">No matches</div>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobWidget;
