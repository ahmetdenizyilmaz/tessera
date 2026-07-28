import React from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';
import CopyButton from './CopyButton';

const MCPWidget: React.FC<ToolWidgetProps> = ({ name, input, result }) => {
  // Extract server name from mcp__servername__toolname format
  const parts = name.split('__');
  const serverName = parts.length >= 3 ? parts[1] : 'mcp';
  const toolName = parts.length >= 3 ? parts.slice(2).join('__') : name;

  return (
    <div className="tool-widget">
      <div className="tool-widget__header">
        <span className="tool-widget__mcp-server-badge">{serverName}</span>
        <span className="tool-widget__name">{toolName}</span>
        {result && <CopyButton text={result} />}
      </div>
      {Object.keys(input).length > 0 && (
        <div className="tool-widget__body">
          <pre className="tool-widget__pre">{JSON.stringify(input, null, 2)}</pre>
        </div>
      )}
      {result && (
        <div className="tool-widget__body">
          <pre className="tool-widget__pre" style={{ maxHeight: 200, overflowY: 'auto' }}>{result}</pre>
        </div>
      )}
    </div>
  );
};

export default MCPWidget;
