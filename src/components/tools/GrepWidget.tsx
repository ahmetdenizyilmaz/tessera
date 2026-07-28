import React, { useState } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

const GrepWidget: React.FC<ToolWidgetProps> = ({ input, result }) => {
  const [expanded, setExpanded] = useState(false);
  const pattern = (input.pattern as string) ?? '';
  const path = (input.path as string) ?? '';

  const lines = result ? result.split('\n').filter((l) => l.trim()) : [];

  return (
    <div className="tool-widget tool-widget--grep">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#128270;</span>
        <span className="tool-widget__label">Grep</span>
        <code className="tool-widget__pattern">{pattern}</code>
        {lines.length > 0 && <span className="tool-widget__meta">{lines.length} matches</span>}
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          {path && <div className="tool-widget__description">in {path}</div>}
          {lines.length > 0 ? (
            <pre className="tool-widget__grep-results">
              {lines.map((line, i) => {
                // Try to highlight the matched pattern
                const regex = safeRegex(pattern);
                if (regex) {
                  const parts = line.split(regex);
                  const matches = line.match(regex);
                  return (
                    <div key={i} className="tool-widget__grep-line">
                      {parts.map((part, j) => (
                        <React.Fragment key={j}>
                          {part}
                          {matches && j < matches.length && (
                            <mark className="tool-widget__grep-highlight">{matches[j]}</mark>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  );
                }
                return <div key={i} className="tool-widget__grep-line">{line}</div>;
              })}
            </pre>
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

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(`(${pattern})`, 'gi');
  } catch {
    return null;
  }
}

export default GrepWidget;
