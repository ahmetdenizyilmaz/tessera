import React, { useState } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

interface SearchResult {
  title?: string;
  url?: string;
  snippet?: string;
}

function parseResults(result?: string): SearchResult[] {
  if (!result) return [];
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall back to treating each line as a result
  }
  return result
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => ({ title: line, snippet: '' }));
}

const WebSearchWidget: React.FC<ToolWidgetProps> = ({ input, result }) => {
  const [expanded, setExpanded] = useState(false);
  const query = (input.query as string) ?? '';
  const results = parseResults(result);

  return (
    <div className="tool-widget tool-widget--websearch">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#127760;</span>
        <span className="tool-widget__label">Web Search</span>
        <span className="tool-widget__query">"{query}"</span>
        {results.length > 0 && <span className="tool-widget__meta">{results.length} results</span>}
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          {results.length > 0 ? (
            <div className="tool-widget__search-results">
              {results.map((r, i) => (
                <div key={i} className="tool-widget__search-card">
                  <div className="tool-widget__search-title">{r.title ?? 'Result'}</div>
                  {r.url && <div className="tool-widget__search-url">{r.url}</div>}
                  {r.snippet && <div className="tool-widget__search-snippet">{r.snippet}</div>}
                </div>
              ))}
            </div>
          ) : result == null ? (
            <div className="tool-widget__loading">Searching...</div>
          ) : (
            <div className="tool-widget__empty">No results</div>
          )}
        </div>
      )}
    </div>
  );
};

export default WebSearchWidget;
