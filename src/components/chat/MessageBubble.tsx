import React, { useState, useEffect, useMemo, useCallback } from 'react';
import AnsiToHtml from 'ansi-to-html';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import MarkdownRenderer from './MarkdownRenderer';
import type { ChatMessage, ChoiceOption, TuiChoice } from '../../types/chat';

// Module-level ANSI converter (reused across renders)
const ansiConverter = new AnsiToHtml({ escapeXML: true, newline: false });

interface MessageBubbleProps {
  message: ChatMessage;
  instanceId: string;
  onSendChoice?: (choice: number) => void;
}

function formatTime(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Image / ANSI cleanup ─────────────────────────────────────
// Matches [Images: path1, path2, ...] — our internal format for sending images to Claude
const IMAGES_TAG_RE = /\[Images?:\s*[^\]]*\]/g;
// Strip ANSI escape sequences (ESC[...m) and bare bracket codes ([7m, [38;2;...m etc.)
const ANSI_RE = /(?:\x1B\[[0-9;]*[A-Za-z]|\[[0-9;]*m)/g;
const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

/** Strip [Images: ...] tags, ANSI junk, and separator lines from text */
function cleanDisplayText(text: string): string {
  return text
    .replace(IMAGES_TAG_RE, '')
    .replace(ANSI_RE, '')
    .replace(/^[-\u2500\u2501\u2550]{3,}\s*$/gm, '')
    .trim();
}

/** Extract image paths from [Images: ...] tags */
function extractImageTagPaths(text: string): string[] {
  const paths: string[] = [];
  const re = /\[Images?:\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const items = m[1].split(',').map((p) => p.trim()).filter((p) => IMAGE_EXTS.test(p));
    paths.push(...items);
  }
  return paths;
}

/**
 * Detect standalone image file paths in text (NOT [Images:...] tags).
 * Matches absolute paths like C:\...\img.png or /home/.../img.png
 */
const STANDALONE_PATH_RE = /(?:[A-Z]:[\\\/][^\s,<>"']+|\/[^\s,<>"']+)\.(png|jpe?g|gif|webp|bmp|svg|ico)\b/gi;

function extractStandaloneImagePaths(text: string): { cleaned: string; paths: string[] } {
  const paths: string[] = [];
  const cleaned = text.replace(STANDALONE_PATH_RE, (match) => {
    if (IMAGE_EXTS.test(match)) {
      paths.push(match);
      return ''; // remove path from text
    }
    return match;
  });
  return { cleaned: cleaned.trim(), paths };
}

/** Render local image files inline */
const InlineImages: React.FC<{ paths: string[] }> = ({ paths }) => {
  if (paths.length === 0) return null;
  return (
    <div className="msg-inline-images">
      {paths.map((p, i) => {
        let src: string;
        try {
          src = convertFileSrc(p);
        } catch {
          src = p;
        }
        return (
          <img
            key={`${i}-${p}`}
            src={src}
            alt={p.split(/[/\\]/).pop() ?? 'image'}
            className="msg-inline-image"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        );
      })}
    </div>
  );
};

// ── Tool icons ────────────────────────────────────────────────
const TOOL_ICONS: Record<string, string> = {
  Read: '\u{1F4C4}', Write: '\u270F\uFE0F', Edit: '\u270F\uFE0F', Bash: '\u25B6', Glob: '\u{1F50D}',
  Grep: '\u{1F50E}', Task: '\u{1F4CB}', WebFetch: '\u{1F310}', WebSearch: '\u{1F310}',
  TodoWrite: '\u2611', TodoRead: '\u2611', NotebookEdit: '\u{1F4D3}',
};

// Tool type classes for icon tints
const TOOL_TYPE_CLASS: Record<string, string> = {
  Read: 'tool-read', Write: 'tool-write', Edit: 'tool-write',
  Bash: 'tool-bash', Glob: 'tool-search', Grep: 'tool-search',
  WebFetch: 'tool-web', WebSearch: 'tool-web',
};

// Match tool calls with optional bullet prefix
const TOOL_RE = /^[●•\s]*(Read|Write|Edit|Bash|Glob|Grep|Task|TaskOutput|WebFetch|WebSearch|TodoWrite|TodoRead|NotebookEdit)\((.*)$/;

interface ActionSegment {
  type: 'action';
  toolName: string;
  args: string;
  output: string[];
}
interface TextSegment { type: 'text'; value: string; }
type ContentSegment = TextSegment | ActionSegment;

interface ActionGroupSegment {
  type: 'action-group';
  actions: ActionSegment[];
}
type DisplaySegment = TextSegment | ActionSegment | ActionGroupSegment;

/** Split content into text and action segments */
function parseContent(content: string): ContentSegment[] {
  const lines = content.split('\n');
  const parts: ContentSegment[] = [];
  let textLines: string[] = [];
  let currentAction: ActionSegment | null = null;

  const flushText = () => {
    if (textLines.length) {
      const s = textLines.join('\n').trim();
      if (s) parts.push({ type: 'text', value: s });
      textLines = [];
    }
  };
  const flushAction = () => {
    if (currentAction) {
      parts.push(currentAction);
      currentAction = null;
    }
  };

  for (const line of lines) {
    const toolMatch = line.match(TOOL_RE);
    if (toolMatch) {
      flushText();
      flushAction();
      let args = toolMatch[2].trim();
      if (args.endsWith(')')) args = args.slice(0, -1);
      currentAction = { type: 'action', toolName: toolMatch[1], args, output: [] };
      continue;
    }

    const t = line.trimStart();
    if (currentAction && /^[\u23BF\u2504\u21B3]/.test(t)) {
      currentAction.output.push(t.replace(/^[\u23BF\u2504\u21B3]\s*/, ''));
      continue;
    }

    if (currentAction && t === '') {
      currentAction.output.push('');
      continue;
    }

    if (currentAction) {
      flushAction();
    }
    textLines.push(line);
  }
  flushText();
  flushAction();
  return parts;
}

/** Group 2+ consecutive ActionSegments into ActionGroupSegments */
function groupSegments(parts: ContentSegment[]): DisplaySegment[] {
  const result: DisplaySegment[] = [];
  let i = 0;
  while (i < parts.length) {
    if (parts[i].type === 'action') {
      let j = i + 1;
      while (j < parts.length && parts[j].type === 'action') j++;
      const actions = parts.slice(i, j) as ActionSegment[];
      if (actions.length >= 2) {
        result.push({ type: 'action-group', actions });
      } else {
        result.push(actions[0]);
      }
      i = j;
    } else {
      result.push(parts[i] as TextSegment);
      i++;
    }
  }
  return result;
}

// ── Action output line renderer (with ANSI color support) ────

const ActionOutputLine: React.FC<{ line: string }> = ({ line }) => {
  if (line.includes('\x1B[')) {
    const html = ansiConverter.toHtml(line);
    return (
      <div
        className="msg-action-output-line msg-action-output--ansi"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <div className="msg-action-output-line">{line}</div>;
};

// ── Diff rendering utilities ─────────────────────────────────

/** Check if an action segment looks like a diff (Edit/Write with +/- lines) */
function isDiffAction(segment: ActionSegment): boolean {
  if (segment.toolName !== 'Edit' && segment.toolName !== 'Write') return false;
  for (const line of segment.output) {
    const stripped = line.replace(ANSI_RE, '').trimStart();
    if (stripped.startsWith('+') || stripped.startsWith('-')) return true;
  }
  return false;
}

type DiffLineType = 'added' | 'removed' | 'context' | 'header' | 'meta';

interface DiffLine {
  type: DiffLineType;
  content: string;
}

/** Classify a single diff output line */
function classifyDiffLine(rawLine: string): DiffLine {
  const stripped = rawLine.replace(ANSI_RE, '').trimStart();
  if (stripped.startsWith('@@')) return { type: 'header', content: rawLine };
  if (stripped.startsWith('---') || stripped.startsWith('+++')) return { type: 'header', content: rawLine };
  if (stripped.startsWith('+')) return { type: 'added', content: rawLine };
  if (stripped.startsWith('-')) return { type: 'removed', content: rawLine };
  if (/^(Updated|Created|Wrote)\s/i.test(stripped)) return { type: 'meta', content: rawLine };
  return { type: 'context', content: rawLine };
}

/** Extract shortened file path from action args */
function extractDiffFilePath(segment: ActionSegment): string {
  let p = segment.args;
  if (p.includes('/')) {
    const segs = p.split('/');
    if (segs.length > 2) p = '\u2026/' + segs.slice(-2).join('/');
  } else if (p.includes('\\')) {
    const segs = p.split('\\');
    if (segs.length > 2) p = '\u2026\\' + segs.slice(-2).join('\\');
  }
  return p;
}

// ── Diff line content renderer ────────────────────────────────

const DiffLineContent: React.FC<{ line: DiffLine }> = ({ line }) => {
  const clean = line.content.replace(ANSI_RE, '').trimStart();
  let prefix = '';
  let text = clean;

  if (line.type === 'added' && clean.startsWith('+')) {
    prefix = '+';
    text = clean.slice(1);
  } else if (line.type === 'removed' && clean.startsWith('-')) {
    prefix = '-';
    text = clean.slice(1);
  }

  return (
    <div className={`diff-line diff-line--${line.type}`}>
      {prefix && <span className="diff-line-prefix">{prefix}</span>}
      <span className="diff-line-content">{text || ' '}</span>
    </div>
  );
};

// ── Diff view component ──────────────────────────────────────

const DiffView: React.FC<{ segment: ActionSegment }> = ({ segment }) => {
  const filePath = extractDiffFilePath(segment);
  const diffLines = segment.output
    .filter((l) => l.trim().length > 0)
    .map(classifyDiffLine);

  let added = 0;
  let removed = 0;
  for (const dl of diffLines) {
    if (dl.type === 'added') added++;
    if (dl.type === 'removed') removed++;
  }

  return (
    <div className="diff-view">
      <div className="diff-header">
        <span className="diff-header-icon">{TOOL_ICONS[segment.toolName] || '\u270F\uFE0F'}</span>
        <span className="diff-header-path">{filePath}</span>
        <span className="diff-header-stats">
          {added > 0 && <span className="diff-stat-added">+{added}</span>}
          {removed > 0 && <span className="diff-stat-removed">&minus;{removed}</span>}
        </span>
      </div>
      <div className="diff-body">
        {diffLines.map((dl, i) => (
          <DiffLineContent key={i} line={dl} />
        ))}
      </div>
    </div>
  );
};

// ── Interactive choice detection ─────────────────────────────

interface ChoiceBlock {
  before: string;
  options: ChoiceOption[];
}

// Footer/navigation hints that Claude Code appends to TUI choice prompts
const TUI_FOOTER_RE = /^(Enter to select|Tab\/Arrow keys|Esc to cancel|\u2191\u2193 to navigate|\u2190\u2192|ctrl\+)/i;
// Tab bar lines like: ← ☐ Site type ☐ Experience ✔ Submit →
const TUI_TABBAR_RE = /^[\u2190\u2192]\s+[\u2610\u2714]/;

/** Detect Claude Code TUI choice prompts (numbered lists with optional descriptions). */
function detectChoices(text: string): ChoiceBlock | null {
  const lines = text.split('\n').filter((l) => {
    const t = l.trim();
    return !TUI_FOOTER_RE.test(t) && !TUI_TABBAR_RE.test(t);
  });

  const CHOICE_LINE_RE = /^\s*[❯>]?\s*(\d+)\.\s+(.+)$/;
  let firstChoiceLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (CHOICE_LINE_RE.test(lines[i])) {
      firstChoiceLine = i;
      break;
    }
  }
  if (firstChoiceLine < 0) return null;

  const options: ChoiceOption[] = [];
  let i = firstChoiceLine;
  while (i < lines.length) {
    const m = lines[i].match(CHOICE_LINE_RE);
    if (m) {
      const label = m[2].trim();
      const descLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !CHOICE_LINE_RE.test(lines[j])) {
        const t = lines[j].trim();
        if (t.length > 0 && !TUI_FOOTER_RE.test(t) && !TUI_TABBAR_RE.test(t)) {
          descLines.push(t);
        }
        j++;
      }
      options.push({
        number: parseInt(m[1], 10),
        label,
        description: descLines.length > 0 ? descLines.join(' ') : undefined,
      });
      i = j;
    } else {
      i++;
    }
  }

  if (options.length < 2) return null;

  return {
    before: lines.slice(0, firstChoiceLine).join('\n').trim(),
    options,
  };
}

/** Interactive choice prompt rendered as cards with keyboard navigation */
const ChoicePromptUI: React.FC<{
  options: (ChoiceOption | TuiChoice)[];
  resolved?: string;
  onSelect: (num: number) => void;
}> = ({ options, resolved, onSelect }) => {
  const [focusedIdx, setFocusedIdx] = useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (resolved) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIdx((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(options[focusedIdx].number);
    } else {
      const n = parseInt(e.key, 10);
      if (!isNaN(n)) {
        const match = options.find((o) => o.number === n);
        if (match) onSelect(match.number);
      }
    }
  };

  return (
    <div
      className="choice-prompt"
      ref={containerRef}
      tabIndex={resolved ? -1 : 0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      {!resolved && (
        <div className="choice-hint">{'\u2191\u2193'} navigate {'\u00B7'} Enter select {'\u00B7'} or click</div>
      )}
      {options.map((opt, idx) => {
        const numStr = String(opt.number);
        const isSelected = resolved === numStr;
        const isDimmed = !!resolved && !isSelected;
        const isFocused = !resolved && idx === focusedIdx;
        const description = 'description' in opt ? opt.description : undefined;
        return (
          <button
            key={opt.number}
            className={`choice-btn${isSelected ? ' choice-btn--selected' : ''}${isDimmed ? ' choice-btn--dimmed' : ''}${isFocused ? ' choice-btn--focused' : ''}`}
            onClick={() => !resolved && onSelect(opt.number)}
            disabled={!!resolved}
          >
            <span className="choice-cursor">{isFocused ? '\u276F' : ' '}</span>
            <span className="choice-number">{opt.number}</span>
            <span className="choice-text">
              <span className="choice-label">{opt.label}</span>
              {description && <span className="choice-description">{description}</span>}
            </span>
            {isSelected && <span className="choice-check">{'\u2713'}</span>}
          </button>
        );
      })}
    </div>
  );
};

/** Collapsible action info line */
const ActionLine: React.FC<{ segment: ActionSegment }> = ({ segment }) => {
  const isDiff = isDiffAction(segment);
  const [expanded, setExpanded] = useState(isDiff);
  const icon = TOOL_ICONS[segment.toolName] || '\u2699';
  const typeClass = TOOL_TYPE_CLASS[segment.toolName] || '';
  const hasOutput = segment.output.some((l) => l.trim().length > 0);

  // Auto-expand when diff is detected mid-stream
  useEffect(() => {
    if (isDiff) setExpanded(true);
  }, [isDiff]);

  let displayArgs = segment.args;
  if (segment.toolName !== 'Bash' && displayArgs.includes('/')) {
    const segs = displayArgs.split('/');
    displayArgs = segs.length > 2 ? '\u2026/' + segs.slice(-2).join('/') : displayArgs;
  }
  if (segment.toolName === 'Bash' && displayArgs.length > 80) {
    displayArgs = displayArgs.slice(0, 77) + '\u2026';
  }

  return (
    <div className={`msg-action${isDiff ? ' msg-action--diff' : ''}`}>
      <button
        className={`msg-action-header ${hasOutput ? 'msg-action-header--clickable' : ''}`}
        onClick={() => hasOutput && setExpanded((e) => !e)}
        title={segment.args}
      >
        <span className={`msg-action-icon ${typeClass}`}>{icon}</span>
        <span className="msg-action-tool">{segment.toolName}</span>
        <span className="msg-action-args">{displayArgs}</span>
        {hasOutput && (
          <span className={`msg-action-chevron ${expanded ? 'msg-action-chevron--open' : ''}`}>
            {'\u203A'}
          </span>
        )}
      </button>
      {expanded && hasOutput && (
        isDiff ? (
          <DiffView segment={segment} />
        ) : (
          <pre className="msg-action-output">
            {segment.output.map((line, i) => (
              <ActionOutputLine key={i} line={line} />
            ))}
          </pre>
        )
      )}
    </div>
  );
};

/** Collapsible group of consecutive action lines */
const ActionGroup: React.FC<{ actions: ActionSegment[] }> = ({ actions }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="msg-action-group">
      <button
        className="msg-action-group-header"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="msg-action-group-icon">{'\u2699'}</span>
        <span className="msg-action-group-label">{actions.length} tool calls</span>
        <span className={`msg-action-chevron ${expanded ? 'msg-action-chevron--open' : ''}`}>{'\u203A'}</span>
      </button>
      {expanded && (
        <div className="msg-action-group-body">
          {actions.map((action, i) => (
            <ActionLine key={i} segment={action} />
          ))}
        </div>
      )}
    </div>
  );
};

const MessageBubbleImpl: React.FC<MessageBubbleProps> = ({ message, instanceId, onSendChoice }) => {
  const time = formatTime(message.timestamp);

  const handlePermissionAction = useCallback(
    async (action: 'allow' | 'deny') => {
      const data = action === 'allow' ? 'y\r' : 'n\r';
      try {
        await invoke('pty_write', { id: instanceId, data });
      } catch (err) {
        console.error(`Failed to send permission ${action}:`, err);
      }
    },
    [instanceId]
  );

  const handleChoiceSelect = useCallback(
    (num: number) => {
      if (onSendChoice) {
        onSendChoice(num);
      }
    },
    [onSendChoice]
  );

  // ── User ──────────────────────────────────────────────────────────────────
  if (message.role === 'user') {
    const displayText = cleanDisplayText(message.content);
    const imagePaths = message.images && message.images.length > 0
      ? message.images
      : extractImageTagPaths(message.content);
    return (
      <div className="msg msg--user">
        <div className="msg-header msg-header--user">
          <span className="msg-label">You</span>
          {time && <span className="msg-time">{time}</span>}
        </div>
        <div className="msg-body msg-body--user">
          {displayText && <p className="msg-user-text">{displayText}</p>}
          <InlineImages paths={imagePaths} />
        </div>
      </div>
    );
  }

  // ── Permission prompt ──────────────────────────────────────────────────────
  if (message.role === 'permission') {
    if (message.permissionPrompt) {
      const { permissionPrompt } = message;
      const resolved = permissionPrompt.resolved;
      return (
        <div className="msg msg--permission">
          <div className="permission-card">
            <div className="permission-card-title">
              <span className="permission-card-icon">{'\u{1F510}'}</span>
              <span>{permissionPrompt.title}</span>
            </div>
            {permissionPrompt.lines.length > 0 && (
              <div className="permission-card-lines">
                {permissionPrompt.lines.map((line, i) => (
                  <div key={i} className="permission-card-line">{line}</div>
                ))}
              </div>
            )}
            <div className="permission-card-actions">
              {resolved ? (
                <span className={`permission-resolved permission-resolved--${resolved}`}>
                  {resolved === 'yes' ? '\u2713 Allowed' : '\u2717 Denied'}
                </span>
              ) : (
                <>
                  <button
                    className="permission-btn permission-btn--allow"
                    onClick={() => handlePermissionAction('allow')}
                  >
                    Allow
                  </button>
                  <button
                    className="permission-btn permission-btn--deny"
                    onClick={() => handlePermissionAction('deny')}
                  >
                    Deny
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }
    // Fallback: render permission as markdown content with buttons
    return (
      <div className="msg msg--permission">
        <div className="permission-card">
          <div className="permission-card-title">
            <span className="permission-card-icon">{'\u{1F510}'}</span>
            <span>Permission Required</span>
          </div>
          <div className="permission-card-lines">
            <MarkdownRenderer content={message.content} />
          </div>
          <div className="permission-card-actions">
            <button
              className="permission-btn permission-btn--allow"
              onClick={() => handlePermissionAction('allow')}
            >
              Allow
            </button>
            <button
              className="permission-btn permission-btn--deny"
              onClick={() => handlePermissionAction('deny')}
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant ─────────────────────────────────────────────────────────────
  if (message.role === 'assistant') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const rawParts = useMemo(() => parseContent(message.content), [message.content]);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const parts = useMemo(() => groupSegments(rawParts), [rawParts]);

    // Find index of last action group to add phase separator before first text after tools
    let lastActionIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type === 'action' || parts[i].type === 'action-group') {
        lastActionIdx = i;
        break;
      }
    }

    return (
      <div className="msg msg--assistant">
        <div className="msg-header">
          <span className="msg-claude-dot">{'\u2726'}</span>
          <span className="msg-label">Claude</span>
          {message.isStreaming && (
            <span className="msg-streaming-dots">
              <span /><span /><span />
            </span>
          )}
          {time && !message.isStreaming && <span className="msg-time">{time}</span>}
        </div>

        <div className="msg-body msg-body--assistant">
          {parts.length === 0 && message.isStreaming && (
            <span className="streaming-cursor"><span className="streaming-dot" /></span>
          )}

          {/* TUI choice prompt -- rendered directly from structured data */}
          {message.tuiChoices && message.tuiChoices.length > 0 && (
            <div className="msg-tui-choices">
              <ChoicePromptUI
                options={message.tuiChoices}
                resolved={message.choiceResolved}
                onSelect={handleChoiceSelect}
              />
            </div>
          )}

          {parts.map((part, i) => {
            const isLastAction = i === lastActionIdx;
            const nextIsText = isLastAction && i + 1 < parts.length && parts[i + 1].type === 'text';

            if (part.type === 'action-group') {
              return (
                <React.Fragment key={i}>
                  <ActionGroup actions={part.actions} />
                  {nextIsText && <div className="msg-phase-separator" />}
                </React.Fragment>
              );
            }
            if (part.type === 'action') {
              return (
                <React.Fragment key={i}>
                  <ActionLine segment={part} />
                  {nextIsText && <div className="msg-phase-separator" />}
                </React.Fragment>
              );
            }
            // Strip [Images:...] tags and ANSI, then detect standalone image paths
            const stripped = cleanDisplayText(part.value);
            const { cleaned, paths } = extractStandaloneImagePaths(stripped);

            // Detect interactive choices in the last text segment (only when not streaming)
            const isLastText = i === parts.length - 1;
            const choiceBlock = isLastText && !message.isStreaming ? detectChoices(cleaned) : null;

            return (
              <div key={i} className="msg-text-part">
                {choiceBlock ? (
                  <>
                    {choiceBlock.before && <MarkdownRenderer content={choiceBlock.before} />}
                    <ChoicePromptUI
                      options={choiceBlock.options}
                      resolved={message.choiceResolved}
                      onSelect={handleChoiceSelect}
                    />
                  </>
                ) : (
                  cleaned && <MarkdownRenderer content={cleaned} />
                )}
                <InlineImages paths={paths} />
                {message.isStreaming && isLastText && (
                  <span className="streaming-cursor"><span className="streaming-dot" /></span>
                )}
              </div>
            );
          })}

          {/* Elapsed time + token usage footer */}
          {!message.isStreaming && (message.elapsedMs !== undefined || message.tokenUsage) && (
            <div className="msg-footer">
              {message.elapsedMs !== undefined && (
                <span className="msg-footer-item">
                  <em className="msg-footer-icon">{'\u23F1'}</em>
                  {message.elapsedMs < 1000
                    ? `${message.elapsedMs}ms`
                    : `${(message.elapsedMs / 1000).toFixed(1)}s`}
                </span>
              )}
              {message.tokenUsage?.inputTokens !== undefined && (
                <span className="msg-footer-item">
                  <em className="msg-footer-icon">{'\u2191'}</em>
                  {message.tokenUsage.inputTokens.toLocaleString()} in
                </span>
              )}
              {message.tokenUsage?.outputTokens !== undefined && (
                <span className="msg-footer-item">
                  <em className="msg-footer-icon">{'\u2193'}</em>
                  {message.tokenUsage.outputTokens.toLocaleString()} out
                </span>
              )}
              {message.tokenUsage?.cost !== undefined && message.tokenUsage.cost > 0 && (
                <span className="msg-footer-item">
                  <em className="msg-footer-icon">$</em>
                  {message.tokenUsage.cost.toFixed(4)}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── System ────────────────────────────────────────────────────────────────
  return (
    <div className="msg msg--system">
      <span>
        <span className="msg-system-icon">{'\u21BB'}</span>
        {message.content}
      </span>
    </div>
  );
};

// Skip re-render for settled messages -- only the actively-streaming message needs updates.
// This prevents the entire message list re-rendering on every PTY chunk.
export const MessageBubble = React.memo(MessageBubbleImpl, (prev, next) => {
  if (prev.message.id !== next.message.id) return false;
  // Always re-render if either side is streaming (content or isStreaming flag may change)
  if (prev.message.isStreaming || next.message.isStreaming) return false;
  return (
    prev.message.content === next.message.content &&
    prev.message.choiceResolved === next.message.choiceResolved &&
    prev.message.permissionPrompt?.resolved === next.message.permissionPrompt?.resolved &&
    prev.instanceId === next.instanceId
  );
});

export default MessageBubble;
