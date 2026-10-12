import { describe, expect, it } from 'vitest';
import { extractPaths, looksLikePath } from './openPath';
import { findPathReferences } from './pathDetection';

describe('path detection in chats', () => {
  it('accepts absolute, home and relative paths with a separator', () => {
    for (const p of ['C:\\Users\\ady\\Desktop\\claude_folder', 'C:/Users/ady/x.py', '~/Desktop/app', 'src/lib/office.ts', 'Desktop/claude_folder/diffusionVL', '../docs/readme.md', 'C:\\Users\\ady\\Desktop\\desktop controller', 'claude_folder/app', 'src/lib', 'a/b/c'])
      expect(looksLikePath(p), p).toBe(true);
  });
  it('rejects words, URLs, dates and fractions', () => {
    for (const p of ['office.ts', 'npm', 'https://example.com/a/b', '10/4/2026', '3/4', 'a b/c', 'and/or', ''])
      expect(looksLikePath(p), p).toBe(false);
  });
  it('and/or is not a path but src/lib is', () => {
    expect(looksLikePath('and/or')).toBe(false);
    expect(looksLikePath('src/lib')).toBe(true);
  });
  it('extracts prose and inline-code paths once each, trimming sentence punctuation', () => {
    const text = 'Saved to C:\\Users\\ady\\Desktop\\out\\report.md. See `src/lib/office.ts` and `src/lib/office.ts` again, plus ~/Desktop/app/.';
    expect(extractPaths(text)).toEqual(['C:\\Users\\ady\\Desktop\\out\\report.md', 'src/lib/office.ts', '~/Desktop/app/']);
  });
  it('does not read a URL scheme as a drive letter', () => {
    expect(extractPaths('Spec: https://example.com/spec and ftp://host/x')).toEqual([]);
    expect(extractPaths('file:///C:/x')).toEqual(['file:///C:/x']);
  });
  it('finds relative folders, roots, filenames and quoted names without treating web URLs as local paths', () => {
    const text = 'See models/checkpoints, ../results/ and "output images/final" or `outputs`. C:\\ /tmp C:/ README.md:12:3 file:///C:/My%20Files#L4 https://example.com/src/docs and/or 3/4';
    const paths = ['models/checkpoints', '../results/', 'output images/final', 'outputs', 'C:\\', '/tmp', 'C:/', 'README.md:12:3', 'file:///C:/My%20Files#L4'];
    expect(findPathReferences(text).map(p => p.path)).toEqual(paths);
    for (const p of findPathReferences(text)) expect(text.slice(p.start, p.end)).toBe(p.path);
  });
  it('preserves Unicode and line references and rejects command/URL schemes', () => {
    expect(extractPaths('📁 src/資料/çalışma.md:12 ~/Documents/notes.md#L4')).toEqual(['src/資料/çalışma.md:12', '~/Documents/notes.md#L4']);
    expect(extractPaths('`.` `..` README.md#L4')).toEqual(['.', '..', 'README.md#L4']);
    for (const s of ['javascript:alert(1)', 'data:text/plain,hello', 'ssh://host/tmp', 'C:\\bad\nname']) expect(looksLikePath(s, true)).toBe(false);
  });
});
