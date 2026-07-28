import React from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';
import CopyButton from './CopyButton';

const NotebookEditWidget: React.FC<ToolWidgetProps> = ({ name, input, result }) => {
  const notebook = (input.notebook as string) ?? '';
  const command = (input.command as string) ?? 'edit';
  const cellNumber = input.cell_number as number ?? 0;
  const newSource = (input.new_source as string) ?? '';

  return (
    <div className="tool-widget">
      <div className="tool-widget__header">
        <span className="tool-widget__icon" style={{ fontSize: 13 }}>&#x1F4D3;</span>
        <span className="tool-widget__name">NotebookEdit</span>
        <span className="tool-widget__badge">{command}</span>
        {notebook && <span className="tool-widget__path">{notebook}</span>}
        {newSource && <CopyButton text={newSource} />}
      </div>
      {cellNumber > 0 && (
        <div className="tool-widget__detail">Cell #{cellNumber}</div>
      )}
      {newSource && (
        <div className="tool-widget__body">
          <pre className="tool-widget__pre">{newSource}</pre>
        </div>
      )}
    </div>
  );
};

export default NotebookEditWidget;
