import React, { useState, useMemo } from 'react';
import { createTwoFilesPatch } from 'diff';
import type { ToolWidgetProps } from './ToolWidgetRegistry';
import CopyButton from './CopyButton';

const EditWidget: React.FC<ToolWidgetProps> = ({ input }) => {
  const [expanded, setExpanded] = useState(false);
  const filePath = (input.file_path as string) ?? '';
  const oldStr = (input.old_string as string) ?? '';
  const newStr = (input.new_string as string) ?? '';
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  const { diffLines, addCount, removeCount } = useMemo(() => {
    const patch = createTwoFilesPatch(fileName, fileName, oldStr, newStr, '', '', { context: 3 });
    const lines = patch.split('\n').slice(4);
    let adds = 0;
    let removes = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) adds++;
      else if (line.startsWith('-') && !line.startsWith('---')) removes++;
    }
    return { diffLines: lines, addCount: adds, removeCount: removes };
  }, [fileName, oldStr, newStr]);

  return (
    <div className="tool-widget tool-widget--edit" style={{ position: 'relative' }}>
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#9998;</span>
        <span className="tool-widget__label">Edit</span>
        <span className="tool-widget__file" title={filePath}>{fileName}</span>
        {addCount > 0 && <span className="tool-widget__badge tool-widget__badge--add">+{addCount}</span>}
        {removeCount > 0 && <span className="tool-widget__badge tool-widget__badge--remove">-{removeCount}</span>}
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body tool-widget__diff">
          <CopyButton text={newStr} />
          <pre className="tool-widget__diff-pre">
            {diffLines.map((line, i) => {
              let cls = 'diff-context';
              if (line.startsWith('+')) cls = 'diff-add';
              else if (line.startsWith('-')) cls = 'diff-remove';
              else if (line.startsWith('@')) cls = 'diff-hunk';
              return (
                <div key={i} className={`diff-line ${cls}`}>
                  <span className="diff-line-num" style={{ display: 'inline-block', width: 32, textAlign: 'right', marginRight: 8, color: 'var(--text-muted)', fontSize: 10, userSelect: 'none' }}>{i + 1}</span>
                  {line}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
};

export default EditWidget;
