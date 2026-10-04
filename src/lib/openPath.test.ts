import { describe, expect, it } from 'vitest';
import { extractPaths, looksLikePath } from './openPath';

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
    expect(extractPaths(text)).toEqual(['C:\\Users\\ady\\Desktop\\out\\report.md', '~/Desktop/app/', 'src/lib/office.ts']);
  });
  it('does not read a URL scheme as a drive letter', () => {
    expect(extractPaths('Spec: https://example.com/spec and ftp://host/x')).toEqual([]);
    expect(extractPaths('file:///C:/x')).toEqual(['C:/x']);
  });
});
