import React, { useState, useMemo } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

interface TodoItem {
  text?: string;
  status?: string;
  completed?: boolean;
}

function parseTodos(input: Record<string, unknown>, result?: string): TodoItem[] {
  const todos = input.todos;
  if (Array.isArray(todos)) return todos as TodoItem[];

  if (result) {
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return result
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => {
          const done = /^\[x\]/i.test(line.trim());
          return { text: line.replace(/^\[[ x]\]\s*/i, ''), completed: done };
        });
    }
  }
  return [];
}

const statusColors: Record<string, string> = {
  completed: 'var(--success)',
  in_progress: 'var(--accent)',
  pending: 'var(--text-muted)',
  blocked: 'var(--error)',
};

const TodoWidget: React.FC<ToolWidgetProps> = ({ name, input, result }) => {
  const [expanded, setExpanded] = useState(true);
  const items = parseTodos(input, result);
  const isWrite = name === 'TodoWrite';

  const { completedCount, percentage } = useMemo(() => {
    if (items.length === 0) return { completedCount: 0, percentage: 0 };
    const done = items.filter(i => i.completed || i.status === 'completed').length;
    return { completedCount: done, percentage: Math.round((done / items.length) * 100) };
  }, [items]);

  return (
    <div className="tool-widget tool-widget--todo">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#9745;</span>
        <span className="tool-widget__label">{isWrite ? 'Todo (write)' : 'Todo (read)'}</span>
        {items.length > 0 && (
          <span className="tool-widget__meta">{completedCount}/{items.length} ({percentage}%)</span>
        )}
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          {items.length > 0 && (
            <div className="tool-widget__progress-bar" style={{ marginBottom: 8 }}>
              <div
                className="tool-widget__progress-fill"
                style={{
                  width: `${percentage}%`,
                  background: percentage === 100 ? 'var(--success)' : 'var(--accent)',
                }}
              />
            </div>
          )}
          {items.length > 0 ? (
            <ul className="tool-widget__todo-list">
              {items.map((item, i) => {
                const isDone = item.completed || item.status === 'completed';
                const color = item.status ? statusColors[item.status] ?? 'var(--text-muted)' : undefined;
                return (
                  <li
                    key={i}
                    className={`tool-widget__todo-item ${isDone ? 'tool-widget__todo-item--done' : ''}`}
                  >
                    <span className="tool-widget__todo-check" style={color ? { color } : undefined}>
                      {isDone ? '\u2611' : '\u2610'}
                    </span>
                    <span>{item.text ?? JSON.stringify(item)}</span>
                    {item.status && item.status !== 'completed' && item.status !== 'pending' && (
                      <span style={{ fontSize: 10, padding: '0 4px', borderRadius: 3, background: 'rgba(74,158,255,0.1)', color: color ?? 'var(--text-muted)', marginLeft: 'auto' }}>
                        {item.status}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="tool-widget__empty">No items</div>
          )}
        </div>
      )}
    </div>
  );
};

export default TodoWidget;
