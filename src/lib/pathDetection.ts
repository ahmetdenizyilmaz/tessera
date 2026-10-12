/** Path-shaped references only. Existence and relative-path bases are checked
 * by the native resolver before a detected reference becomes a link. */
export const PATH_TOKENS = /"[^"\r\n]+"|'[^'\r\n]+'|`[^`\r\n]+`|[^\s"'`<>|()[\]{}]+/gu;

export interface PathReference { path: string; start: number; end: number }

export function trimPath(text: string): string {
  const path = text.trim().replace(/[,;!?]+$/, '');
  return path === '.' || path === '..' ? path : path.replace(/\.+$/, '');
}

export function looksLikePath(text: string, allowBare = false): boolean {
  const s = text.trim().replace(/#L\d+(?:-L?\d+)?$/, '');
  if (!s || s.length > 2048 || /[\x00-\x1f<>|*?]/.test(s)) return false;
  if (/^file:\/\//i.test(s)) {
    try { return new URL(s).protocol === 'file:'; } catch { return false; }
  }
  const absolute = /^(?:[A-Za-z]:[\\/]|~(?:[\\/]|$)|[\\/])/.test(s);
  if (!absolute && /^[A-Za-z][A-Za-z\d+.-]*:/.test(s) && !/^[^:]+\.[A-Za-z\d]+:\d+(?::\d+)?$/.test(s)) return false;
  if (s.includes('://') || /^\d+[\\/]\d+(?:[\\/]\d+)?$/.test(s) || /^(?:and\/or|w\/o)$/i.test(s)) return false;
  if (absolute) return true;
  if (/\s/.test(s) && !allowBare) return false;
  return /[\\/]/.test(s) || (allowBare && /^[\p{L}\p{N}_. -]+(?::\d+(?::\d+)?)?$/u.test(s));
}

export function findPathReferences(text: string): PathReference[] {
  const found: PathReference[] = [];
  for (const match of text.matchAll(PATH_TOKENS)) {
    const quoted = /^["'`]/.test(match[0]);
    const raw = quoted ? match[0].slice(1, -1) : match[0];
    const path = trimPath(raw);
    // Bare names are unambiguous in quotes/code; plain filenames also have an
    // extension. Ordinary prose words don't trigger filesystem lookups.
    const filename = /^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.[A-Za-z][A-Za-z\d]{0,11}(?::\d+(?::\d+)?)?(?:#L\d+)?$/u.test(path);
    if (!looksLikePath(path, quoted || filename)) continue;
    const start = match.index + (quoted ? 1 : 0) + raw.length - raw.trimStart().length;
    found.push({ path, start, end: start + path.length });
  }
  return found;
}
