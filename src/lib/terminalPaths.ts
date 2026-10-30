import type { IBufferCellPosition, ILink, Terminal } from '@xterm/xterm';
import { findPathReferences, looksLikePath, type PathReference } from './pathDetection';
import { openPath, resolvePath, type OpenedPath } from './openPath';
import { activateTerminalLink } from './terminalLinks';

/** Only a selection consisting of one escaped, existing path is normalized.
 * Prose, commands, code and ordinary terminal copies stay byte-for-byte intact. */
export async function terminalSelectionForCopy(text: string, cwd?: string): Promise<string> {
  if (!text.includes('\\_') || /[\r\n]/.test(text)) return text;
  const selection = text.trim();
  const references = findPathReferences(selection);
  if (references.length !== 1 || references[0].path !== selection) return text;
  const target = await resolvePath(selection, cwd);
  return target?.path ?? text;
}

/** OSC 8 file links use the same resolver as detected text. All other URL
 * schemes retain the existing HTTP(S)-only external browser handler. */
export function localTerminalLinkHandler(cwd: () => string | undefined) {
  return (event: MouseEvent, uri: string) => {
    if (looksLikePath(uri, true)) {
      event.preventDefault();
      void openPath(uri, cwd());
    } else activateTerminalLink(event, uri);
  };
}

/** Map UTF-16 text offsets to actual cells (wide/combining characters and
 * soft-wrapped paths cannot be mapped using string length / terminal.cols). */
function logicalLine(terminal: Terminal, y: number) {
  const buffer = terminal.buffer.active;
  let first = y - 1, last = y - 1;
  if (!buffer.getLine(first)) return null;
  while (first > 0 && buffer.getLine(first)?.isWrapped && (y - first) * terminal.cols < 4096) first--;
  while (buffer.getLine(last + 1)?.isWrapped && (last - first + 1) * terminal.cols < 4096) last++;
  let text = '';
  const starts: IBufferCellPosition[] = [], ends: IBufferCellPosition[] = [];
  const cell = buffer.getNullCell();
  for (let row = first; row <= last; row++) {
    const line = buffer.getLine(row)!;
    for (let col = 0; col < Math.min(line.length, terminal.cols); col++) {
      const current = line.getCell(col, cell)!;
      const width = current.getWidth();
      if (!width) continue;
      const chars = current.getChars();
      // xterm leaves an empty cell when a wide glyph wraps one column early.
      if (!chars && col === terminal.cols - 1 && row < last && buffer.getLine(row + 1)?.getCell(0)?.getWidth() === 2) continue;
      const content = chars || ' ';
      text += content;
      for (let i = 0; i < content.length; i++) {
        starts.push({ x: col + 1, y: row + 1 });
        ends.push({ x: col + width, y: row + 1 });
      }
    }
  }
  return { buffer, first, last, text, starts, ends, cols: terminal.cols };
}

type LogicalLine = NonNullable<ReturnType<typeof logicalLine>>;

const PATH_TAIL = /[^\s"'`<>|()[\]{}]*[\\/][^\s"'`<>|()[\]{}]*$/u;
const PATH_HEAD = /^[\p{L}\p{N}_.~$%@+#\\/]/u;

/** Agent TUIs (Codex, Claude Code) insert real line breaks: after a path
 * separator, or mid-name at the right margin. xterm doesn't mark those rows as
 * wrapped, so the file name lands on the next line without the folder. */
function continuesPath(line: LogicalLine, next: LogicalLine) {
  const end = line.text.trimEnd(), tail = PATH_TAIL.exec(end)?.[0];
  if (!tail || !PATH_HEAD.test(next.text.trimStart())) return false;
  return /[\\/]$/.test(tail) || line.ends[end.length - 1].x >= line.cols - 2;
}

/** The logical line at `y`, joined with neighbours a path may continue into.
 * `segments` locate each original line (text offsets and buffer rows). */
function pathLine(terminal: Terminal, y: number) {
  const line = logicalLine(terminal, y);
  if (!line) return null;
  const lines = [line];
  for (let prev; lines.length < 8 && (prev = logicalLine(terminal, lines[0].first)) && continuesPath(prev, lines[0]);) lines.unshift(prev);
  for (let next; lines.length < 8 && (next = logicalLine(terminal, lines[lines.length - 1].last + 2)) && continuesPath(lines[lines.length - 1], next);) lines.push(next);
  let text = '';
  const starts: IBufferCellPosition[] = [], ends: IBufferCellPosition[] = [];
  const segments = lines.map((part, i) => {
    const from = i ? part.text.length - part.text.trimStart().length : 0;
    const to = i < lines.length - 1 ? part.text.trimEnd().length : part.text.length;
    const segment = { start: text.length, end: text.length + to - from, first: part.first, last: part.last };
    text += part.text.slice(from, to);
    starts.push(...part.starts.slice(from, to));
    ends.push(...part.ends.slice(from, to));
    return segment;
  });
  return { buffer: line.buffer, first: lines[0].first, text, starts, ends, segments, cols: line.cols };
}

export function installTerminalPathLinks(terminal: Terminal, getCwd: () => string | undefined) {
  let disposed = false;
  // xterm 6.0 keeps its last line's links when output changes while the mouse
  // is outside the terminal. There is no public cache-invalidation API. Reset
  // only the lookup position, so its next mouse move asks all providers again.
  const invalidateLookup = () => {
    const linkifier = (terminal as unknown as { _core?: { linkifier?: {
      _activeLine: number; _lastBufferCell?: IBufferCellPosition;
    } } })._core?.linkifier;
    if (linkifier && '_activeLine' in linkifier) {
      linkifier._activeLine = -1;
      linkifier._lastBufferCell = undefined;
    }
  };
  const updates = [terminal.onWriteParsed(invalidateLookup), terminal.onScroll(invalidateLookup)];
  const cache = new Map<string, { expires: number; result: Promise<OpenedPath | null> }>();
  const resolve = (path: string, cwd?: string) => {
    const key = `${cwd ?? ''}\0${path}`;
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return saved.result;
    const result = resolvePath(path, cwd);
    cache.set(key, { result, expires: Date.now() + 3000 });
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
    return result;
  };
  const provider = terminal.registerLinkProvider({
    provideLinks(y, callback) {
      const line = pathLine(terminal, y), cwd = getCwd();
      if (!line || disposed) { callback(undefined); return; }
      const stillCurrent = () => {
        const now = !disposed ? pathLine(terminal, y) : null;
        return now?.buffer === line.buffer && now.first === line.first && now.text === line.text && now.cols === line.cols && getCwd() === cwd;
      };
      // Each row underlines only its own part of a path joined across a break.
      const segment = line.segments.find(s => s.first < y && y <= s.last + 1)!;
      const part = (ref: PathReference) => ({ ...ref, start: Math.max(ref.start, segment.start), end: Math.min(ref.end, segment.end) });
      const onRow = (ref: PathReference) => {
        const { start, end } = part(ref);
        return start < end && line.starts[start]?.y <= y && line.ends[end - 1]?.y >= y;
      };
      const joined = findPathReferences(line.text).filter(ref =>
        line.segments.some(s => s.start > 0 && ref.start < s.start && ref.end > s.start) && onRow(ref));
      const own = findPathReferences(line.text.slice(segment.start, segment.end))
        .map(ref => ({ ...ref, start: ref.start + segment.start, end: ref.end + segment.start })).filter(onRow);
      void Promise.all([...joined, ...own].slice(0, 32).map(async ref => ({ ref, target: await resolve(ref.path, cwd) })))
        .then(found => {
          // A joined path is used only when it exists. Otherwise the break was
          // not inside a path, and each line keeps its own references.
          const whole = found.filter(({ ref, target }) => target && joined.includes(ref)).map(({ ref }) => ref);
          return found.filter(({ ref, target }) => target && (whole.includes(ref) ||
            !whole.some(w => w.start < ref.end && ref.start < w.end))).map(({ ref, target }) => {
            const title = `${target!.isDir ? 'Open folder' : 'Show file in folder'}: ${target!.path}`;
            const leave = () => { if (terminal.element?.title === title) terminal.element.removeAttribute('title'); };
            const { start, end } = part(ref);
            const link: ILink = {
              text: ref.path, range: { start: line.starts[start], end: line.ends[end - 1] },
              activate(event) { event.preventDefault(); if (stillCurrent()) void openPath(ref.path, cwd); },
              hover() { if (stillCurrent() && terminal.element) terminal.element.title = title; },
              leave, dispose: leave,
            };
            return link;
          });
        }).then(links => {
          // Async filesystem checks must not attach links to a different frame
          // or a replacement conversation while the terminal is streaming.
          callback(stillCurrent() ? links : undefined);
        });
    },
  });
  return { dispose() { disposed = true; updates.forEach(update => update.dispose()); provider.dispose(); cache.clear(); } };
}
