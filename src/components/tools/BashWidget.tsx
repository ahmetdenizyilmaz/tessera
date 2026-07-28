import React, { useState, useMemo } from 'react';
import type { ToolWidgetProps } from './ToolWidgetRegistry';
import CopyButton from './CopyButton';

const BashWidget: React.FC<ToolWidgetProps> = ({ input, result }) => {
  const [expanded, setExpanded] = useState(false);
  const command = (input.command as string) ?? '';
  const description = (input.description as string) ?? '';
  const timeout = input.timeout as number | undefined;

  const parsed = useMemo(() => {
    if (result == null) return null;
    const exitMatch = result.match(/\n?exit code: (\d+)\s*$/i);
    const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : undefined;
    const output = exitMatch ? result.slice(0, exitMatch.index) : result;

    const lines = output.split('\n');
    const stderrLines = new Set<number>();
    lines.forEach((line, i) => {
      const lower = line.toLowerCase().trimStart();
      if (
        lower.startsWith('error:') ||
        lower.startsWith('error[') ||
        lower.startsWith('stderr:') ||
        lower.startsWith('fatal:') ||
        lower.startsWith('panic:')
      ) {
        stderrLines.add(i);
      }
    });

    return { output, exitCode, lines, stderrLines };
  }, [result]);

  const hasExitError = parsed?.exitCode !== undefined && parsed.exitCode !== 0;

  return (
    <div className={`tool-widget tool-widget--bash${hasExitError ? ' tool-widget--error' : ''}`} style={{ position: 'relative' }}>
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#9654;</span>
        <span className="tool-widget__label">Bash</span>
        <code className="tool-widget__command">
          {command.length > 80 ? command.slice(0, 80) + '...' : command}
        </code>
        {parsed?.exitCode !== undefined && (
          <span
            className="tool-widget__meta"
            style={{ color: hasExitError ? 'var(--error, #f85149)' : 'var(--success, #3fb950)' }}
          >
            exit {parsed.exitCode}
          </span>
        )}
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && (
        <div className="tool-widget__body">
          {description && <div className="tool-widget__description">{description}</div>}
          <pre className="tool-widget__bash-command">{command}</pre>
          {timeout && (
            <div className="tool-widget__description">Timeout: {timeout}ms</div>
          )}
          {parsed != null ? (
            <>
              <div className="tool-widget__output-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Output</span>
                <CopyButton text={parsed.output} className="tool-widget__copy-btn--inline" />
              </div>
              <pre className="tool-widget__bash-output" style={{ maxHeight: 400, overflowY: 'auto' }}>
                {parsed.lines.map((line, i) => (
                  <span
                    key={i}
                    style={parsed.stderrLines.has(i) ? { color: 'var(--error, #f85149)' } : undefined}
                  >
                    {line}
                    {i < parsed.lines.length - 1 ? '\n' : ''}
                  </span>
                ))}
              </pre>
            </>
          ) : (
            <div className="tool-widget__loading">Running...</div>
          )}
        </div>
      )}
    </div>
  );
};

export default BashWidget;
