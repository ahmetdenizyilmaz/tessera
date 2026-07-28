import React from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';
import CopyButton from './CopyButton';
import { Folder, FileText } from 'lucide-react';

const LSWidget: React.FC<ToolWidgetProps> = ({ name, input, result }) => {
  const path = (input.path as string) ?? '.';

  const entries = result
    ? result.split('\n').filter(Boolean).map(line => {
        const isDir = line.endsWith('/') || line.includes('<DIR>');
        return { name: line.replace(/\/$/, ''), isDir };
      })
    : [];

  return (
    <div className="tool-widget">
      <div className="tool-widget__header">
        <span className="tool-widget__icon"><Folder size={14} /></span>
        <span className="tool-widget__name">ls</span>
        <span className="tool-widget__path">{path}</span>
        {result && <CopyButton text={result} />}
      </div>
      {entries.length > 0 && (
        <div className="tool-widget__body" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {entries.map((entry, i) => (
            <div key={i} className="tool-widget__tree-node">
              {entry.isDir ? <Folder size={12} style={{ color: 'var(--accent)', marginRight: 6 }} /> : <FileText size={12} style={{ color: 'var(--text-muted)', marginRight: 6 }} />}
              <span style={{ color: entry.isDir ? 'var(--accent)' : 'var(--text-primary)' }}>{entry.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LSWidget;
