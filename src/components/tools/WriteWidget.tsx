import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ToolWidgetProps } from './ToolWidgetRegistry';

function extensionToLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', html: 'html',
    css: 'css', scss: 'scss', sql: 'sql', sh: 'bash',
    md: 'markdown',
  };
  return map[ext] ?? 'text';
}

const WriteWidget: React.FC<ToolWidgetProps> = ({ input }) => {
  const [expanded, setExpanded] = useState(false);
  const filePath = (input.file_path as string) ?? '';
  const content = (input.content as string) ?? '';
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const language = extensionToLanguage(filePath);

  return (
    <div className="tool-widget tool-widget--write">
      <div className="tool-widget__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-widget__icon">&#9997;</span>
        <span className="tool-widget__label">Write</span>
        <span className="tool-widget__file" title={filePath}>{fileName}</span>
        <span className="tool-widget__meta">{content.split('\n').length} lines</span>
        <span className="tool-widget__chevron">{expanded ? '\u25B4' : '\u25BE'}</span>
      </div>
      {expanded && content && (
        <div className="tool-widget__body">
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
          >
            {content}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
};

export default WriteWidget;
