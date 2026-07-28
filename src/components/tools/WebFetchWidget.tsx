import React, { useState } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

const MAX_PREVIEW_LENGTH = 2000;

const WebFetchWidget: React.FC<ToolWidgetProps> = ({ input, result }) => {
  const [expanded, setExpanded] = useState(false);
  const url = (input.url as string) ?? '';

  const preview = result
    ? result.length > MAX_PREVIEW_LENGTH
      ? result.slice(0, MAX_PREVIEW_LENGTH) + '\n... (truncated)'
      : result
    : null;

  return (
    <div className="tool-widget tool-widget--webfetch">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#128279;</span>
        <span className="tool-widget__label">Fetch</span>
        <span className="tool-widget__url" title={url}>
          {url.length > 60 ? url.slice(0, 60) + '...' : url}
        </span>
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          {preview ? (
            <pre className="tool-widget__fetch-content">{preview}</pre>
          ) : (
            <div className="tool-widget__loading">Fetching...</div>
          )}
        </div>
      )}
    </div>
  );
};

export default WebFetchWidget;
