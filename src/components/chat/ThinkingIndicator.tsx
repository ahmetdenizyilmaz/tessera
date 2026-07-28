import React from 'react';
import type { ThinkingInfo } from '../../types/chat';

const TOOL_ICONS: Record<string, string> = {
  Read: '\u{1F4C4}', Write: '\u270F\uFE0F', Edit: '\u270F\uFE0F', Bash: '\u25B6', Glob: '\u{1F50D}',
  Grep: '\u{1F50E}', Task: '\u{1F4CB}', WebFetch: '\u{1F310}', WebSearch: '\u{1F310}',
  TodoWrite: '\u2611', TodoRead: '\u2611', NotebookEdit: '\u{1F4D3}',
};

function truncateArgs(toolName: string, args: string): string {
  if (toolName !== 'Bash' && (args.includes('/') || args.includes('\\'))) {
    const segs = args.replace(/\\/g, '/').split('/');
    return segs.length > 2 ? '\u2026/' + segs.slice(-2).join('/') : args;
  }
  if (args.length > 55) return args.slice(0, 52) + '\u2026';
  return args;
}

interface ThinkingIndicatorProps {
  thinkingInfo: ThinkingInfo | null;
  activeTool?: string;
  activeToolArgs?: string;
}

const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  thinkingInfo,
  activeTool,
  activeToolArgs,
}) => {
  if (!thinkingInfo) return null;

  const accentColor = 'var(--accent, #4a9eff)';
  const toolName = activeTool || thinkingInfo.activeTool;
  const toolArgs = activeToolArgs || thinkingInfo.activeToolArgs;

  return (
    <div
      className="thinking-indicator"
      style={{ '--thinking-accent': accentColor } as React.CSSProperties}
    >
      {/* Animated shimmer bar */}
      <div
        className="thinking-shimmer"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}22, transparent)` }}
      />

      <div className="thinking-inner">
        {/* Left: spinning icon + label */}
        <div className="thinking-left">
          <span className="thinking-icon" style={{ color: accentColor }}>
            {'\u2733'}
          </span>
          <span className="thinking-label" style={{ color: accentColor }}>
            {thinkingInfo.label || 'Thinking'}
          </span>
          {thinkingInfo.mode && (
            <span className="thinking-mode">{thinkingInfo.mode}</span>
          )}
        </div>

        {/* Right: duration + tokens */}
        <div className="thinking-right">
          {thinkingInfo.duration && (
            <span className="thinking-duration">
              {thinkingInfo.duration}
            </span>
          )}
          {thinkingInfo.tokenCount && (
            <span className="thinking-tokens">
              {'\u2193'} {thinkingInfo.tokenCount} tokens
            </span>
          )}
        </div>
      </div>

      {/* Sub-task row: active tool call */}
      {toolName && (
        <div className="thinking-subtask-row">
          <span className="thinking-subtask-spinner" style={{ color: accentColor }}>
            {'\u25C9'}
          </span>
          <span className="thinking-subtask-tool">{toolName}</span>
          {toolArgs && (
            <span className="thinking-subtask-args">
              {truncateArgs(toolName, toolArgs)}
            </span>
          )}
          <span className="thinking-subtask-icon">
            {TOOL_ICONS[toolName] || '\u2699'}
          </span>
        </div>
      )}
    </div>
  );
};

export default ThinkingIndicator;
