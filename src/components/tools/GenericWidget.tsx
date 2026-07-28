import React, { useState } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

const GenericWidget: React.FC<ToolWidgetProps> = ({ name, input, result }) => {
  const [expanded, setExpanded] = useState(false);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [resultCollapsed, setResultCollapsed] = useState(false);

  const inputJson = JSON.stringify(input, null, 2);
  const isLargeInput = inputJson.split('\n').length > 10;
  const isLargeResult = result != null && result.split('\n').length > 15;

  return (
    <div className="tool-widget tool-widget--generic">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#9881;</span>
        <span className="tool-widget__label">{name}</span>
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          <div className="tool-widget__json-section">
            <div
              className="tool-widget__json-label"
              style={isLargeInput ? { cursor: 'pointer' } : undefined}
              onClick={isLargeInput ? () => setInputCollapsed(!inputCollapsed) : undefined}
            >
              Input {isLargeInput && (inputCollapsed ? '\u25B6' : '\u25BC')}
            </div>
            {!inputCollapsed && (
              <pre className="tool-widget__json">{inputJson}</pre>
            )}
          </div>
          {result != null && (
            <div className="tool-widget__json-section">
              <div
                className="tool-widget__json-label"
                style={isLargeResult ? { cursor: 'pointer' } : undefined}
                onClick={isLargeResult ? () => setResultCollapsed(!resultCollapsed) : undefined}
              >
                Result {isLargeResult && (resultCollapsed ? '\u25B6' : '\u25BC')}
              </div>
              {!resultCollapsed && (
                <pre className="tool-widget__json">{result}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GenericWidget;
