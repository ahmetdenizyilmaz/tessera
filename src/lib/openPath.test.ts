import { describe, expect, it } from 'vitest';
import { extractPaths, looksLikePath, remarkPaths, PATH_SCHEME } from './openPath';
import { findPathReferences } from './pathDetection';
import type { Root, Nodes } from 'mdast';

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
  it('finds Windows relative folders in prose containing contractions', () => {
    const path = 'x2test\\fw_2.2.4x_2.2.5x_wakeups\\';
    for (const text of [
      `I've made the 2-month wake-up charts for all 158 field devices on 2.2.4x and 2.2.5x, one PNG per site. They're in ${path} and I've opened the folder. All times are Turkey time (UTC+3).`,
      `They're in ${path} and I've opened the folder.`,
      `It's saved in ${path} so don't recreate it.`,
      `They're in '${path}' and I've opened the folder.`,
    ]) {
      const references = findPathReferences(text);
      expect(references.map(ref => ref.path), text).toEqual([path]);
      expect(text.slice(references[0].start, references[0].end)).toBe(path);
    }
    expect(extractPaths("I've saved 'output images/final' and 'outputs'.")).toEqual(['output images/final', 'outputs']);
  });
});

describe('path links in Markdown', () => {
  const plainText = (node: Nodes): string => 'value' in node ? node.value : 'children' in node ? node.children.map(plainText).join('') : '';
  const links = (node: Nodes): string[] => node.type === 'link' ? [node.url] : 'children' in node ? node.children.flatMap(links) : [];
  it('finishes on emoji and preserves Unicode, quotes and punctuation around paths', () => {
    const text = '\u{1f4a1} Thinking \u{1f469}\u200d\u{1f4bb} \u{1f680}\u{1f680} See "src/lib/work.ts", then \u{1f4c1} ~/Desktop/project.';
    const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] };
    remarkPaths()(tree);
    expect(plainText(tree)).toBe(text);
    expect(links(tree)).toEqual([PATH_SCHEME + encodeURIComponent('src/lib/work.ts'), PATH_SCHEME + encodeURIComponent('~/Desktop/project')]);
    const once = JSON.stringify(tree);
    remarkPaths()(tree);
    expect(JSON.stringify(tree)).toBe(once);
  });
  it('does not retry suffixes of URLs, fractions or ordinary words as local paths', () => {
    const text = 'https://example.com/docs 3/4 and/or \u{1f600} regular prose';
    const tree: Root = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] };
    remarkPaths()(tree);
    expect(links(tree)).toEqual([]);
    expect(tree.children[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: text }] });
  });
  it('leaves existing links, inline code and fenced code alone', () => {
    const tree: Root = { type: 'root', children: [
      { type: 'paragraph', children: [
        { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'src/link.ts \u{1f600}' }] },
        { type: 'linkReference', identifier: 'ref', referenceType: 'full', children: [{ type: 'text', value: 'src/ref.ts' }] },
        { type: 'inlineCode', value: 'src/inline.ts' },
      ] },
      { type: 'code', value: 'src/code.ts', lang: 'text' },
    ] };
    const before = JSON.stringify(tree);
    remarkPaths()(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});
