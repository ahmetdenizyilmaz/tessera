import React, { useState, useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ToolWidgetProps } from './ToolWidgetRegistry';
import CopyButton from './CopyButton';

function extensionToLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', rb: 'ruby',
    java: 'java', kt: 'kotlin', swift: 'swift', cs: 'csharp',
    cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    xml: 'xml', html: 'html', css: 'css', scss: 'scss',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
    md: 'markdown', dockerfile: 'docker',
  };
  return map[ext] ?? 'text';
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const ReadWidget: React.FC<ToolWidgetProps> = ({ input, result }) => {
  const [expanded, setExpanded] = useState(false);
  const filePath = (input.file_path as string) ?? '';
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const language = extensionToLanguage(filePath);
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;

  const lineCount = useMemo(() => result?.split('\n').length ?? 0, [result]);
  const resultSize = useMemo(() => result ? new Blob([result]).size : 0, [result]);

  return (
    <div className="tool-widget tool-widget--read" style={{ position: 'relative' }}>
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#128196;</span>
        <span className="tool-widget__label">Read</span>
        <span className="tool-widget__file" title={filePath}>{fileName}</span>
        {(offset != null || limit != null) && (
          <span className="tool-widget__badge">
            {offset != null ? `L${offset}` : ''}{offset != null && limit != null ? '-' : ''}{limit != null ? `${(offset ?? 0) + limit}` : ''}
          </span>
        )}
        {result && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{lineCount} lines · {formatSize(resultSize)}</span>}
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && result && (
        <div className="tool-widget__body">
          <CopyButton text={result} />
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            customStyle={{
              margin: 0,
              borderRadius: '0 0 8px 8px',
              fontSize: '12px',
              maxHeight: '400px',
            }}
            showLineNumbers
            startingLineNumber={offset ?? 1}
          >
            {result}
          </SyntaxHighlighter>
        </div>
      )}
      {expanded && !result && (
        <div className="tool-widget__body tool-widget__loading">Reading file...</div>
      )}
    </div>
  );
};

export default ReadWidget;
