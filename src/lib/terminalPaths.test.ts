import { describe, expect, it, vi } from 'vitest';
import type { ILinkProvider, Terminal } from '@xterm/xterm';
import { openPath, resolvePath } from './openPath';
import { installTerminalPathLinks, localTerminalLinkHandler, terminalSelectionForCopy } from './terminalPaths';

vi.mock('./openPath', () => ({ openPath: vi.fn(), resolvePath: vi.fn() }));
vi.mock('./terminalLinks', () => ({ activateTerminalLink: vi.fn() }));

/** Rows separated by real line breaks, as an agent TUI writes them. */
function fixture(text: string | string[], cols = Math.max(80, ...[text].flat().map(row => row.length + 1))) {
  let provider: ILinkProvider;
  const lines = [text].flat().map(row => ({ isWrapped: false, length: cols, getCell: (x: number) => ({ getWidth: () => 1, getChars: () => row[x] ?? '' }) }));
  const terminal = { cols, buffer: { active: { getLine: (y: number) => lines[y], getNullCell: () => ({}) } },
    onWriteParsed: () => ({ dispose() {} }), onScroll: () => ({ dispose() {} }),
    registerLinkProvider: (p: ILinkProvider) => { provider = p; return { dispose: vi.fn() }; },
  } as unknown as Terminal;
  return { terminal, links: (y = 1) => new Promise<Parameters<Parameters<ILinkProvider['provideLinks']>[1]>[0]>(resolve => provider.provideLinks(y, resolve)) };
}

describe('terminal filesystem links', () => {
  it('keeps the entire displayed escaped path clickable, including the final extension', async () => {
    vi.mocked(resolvePath).mockReset(); vi.mocked(openPath).mockReset();
    const raw = String.raw`C:/Users/DENIZYILMAZ/Desktop/Projects/mate\_health\_report/docs/JEV\_DECISION\_TREE.md`;
    const target = raw.replace(/\\_/g, '_').replaceAll('/', '\\');
    vi.mocked(resolvePath).mockResolvedValue({ path: target, isDir: false, base: 'absolute' });
    const f = fixture(`Created ${raw}.`);
    const subscription = installTerminalPathLinks(f.terminal, () => 'C:/project');
    const links = await f.links();
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(raw);
    expect(links![0].range).toEqual({ start: { x: 9, y: 1 }, end: { x: 8 + raw.length, y: 1 } });
    links![0].activate({ preventDefault() {} } as MouseEvent, raw);
    expect(openPath).toHaveBeenCalledWith(raw, 'C:/project');
    subscription.dispose();
  });

  it('links only existing paths, caches hover lookups and rechecks when the panel folder changes', async () => {
    vi.mocked(resolvePath).mockReset(); vi.mocked(openPath).mockReset();
    vi.mocked(resolvePath).mockImplementation(async (path, cwd) => path === 'src/assets'
      ? { path: `${cwd}/src/assets`, isDir: true, base: 'cwd' } : null);
    const f = fixture('See src/assets and src/missing https://example.com/docs');
    let cwd = 'C:/first';
    const links = installTerminalPathLinks(f.terminal, () => cwd);
    const first = await f.links();
    expect(first?.map(link => link.text)).toEqual(['src/assets']);
    expect(resolvePath).toHaveBeenCalledTimes(2);
    await f.links();
    expect(resolvePath).toHaveBeenCalledTimes(2);
    first![0].activate({ preventDefault() {} } as MouseEvent, 'src/assets');
    expect(openPath).toHaveBeenCalledWith('src/assets', 'C:/first');
    cwd = 'C:/second';
    (await f.links())![0].activate({ preventDefault() {} } as MouseEvent, 'src/assets');
    expect(openPath).toHaveBeenLastCalledWith('src/assets', 'C:/second');
    expect(resolvePath).toHaveBeenCalledTimes(4);
    f.terminal.buffer.active.getLine = () => undefined;
    first![0].activate({ preventDefault() {} } as MouseEvent, 'src/assets');
    expect(openPath).toHaveBeenCalledTimes(2);
    links.dispose();
  });

  it.each(['output', 'folder', 'dispose'])('discards a lookup after the %s changes', async change => {
    let finish: (value: Awaited<ReturnType<typeof resolvePath>>) => void;
    vi.mocked(resolvePath).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const f = fixture('src/assets');
    let cwd = 'C:/first';
    const links = installTerminalPathLinks(f.terminal, () => cwd);
    const pending = f.links();
    if (change === 'output') f.terminal.buffer.active.getLine = () => undefined;
    if (change === 'folder') cwd = 'C:/other';
    if (change === 'dispose') links.dispose();
    finish!({ path: 'C:/first/src/assets', isDir: true, base: 'cwd' });
    expect(await pending).toBeUndefined();
    links.dispose();
  });

  it('joins a path the TUI broke after a separator, on both of its rows', async () => {
    vi.mocked(resolvePath).mockReset(); vi.mocked(openPath).mockReset();
    const full = 'C:/Users/ady/projects/star/out/star_music_and_sfx.mp4';
    vi.mocked(resolvePath).mockImplementation(async path => path === full
      ? { path: full.replaceAll('/', '\\'), isDir: false, base: 'absolute' } : null);
    const f = fixture(['Open the video (C:/Users/ady/projects/star/out/', '  star_music_and_sfx.mp4)', 'Saved separately.']);
    const links = installTerminalPathLinks(f.terminal, () => 'C:/project');
    const [first, second, after] = [await f.links(1), await f.links(2), await f.links(3)];
    expect(first?.map(link => link.text)).toEqual([full]);
    expect(second?.map(link => link.text)).toEqual([full]);
    expect(after).toEqual([]);
    // Each row underlines only its own cells; both open the whole path.
    expect(first![0].range).toEqual({ start: { x: 17, y: 1 }, end: { x: 47, y: 1 } });
    expect(second![0].range).toEqual({ start: { x: 3, y: 2 }, end: { x: 24, y: 2 } });
    second![0].activate({ preventDefault() {} } as MouseEvent, full);
    expect(openPath).toHaveBeenCalledWith(full, 'C:/project');
    links.dispose();
  });

  it('joins a path hard-wrapped at the right margin', async () => {
    vi.mocked(resolvePath).mockReset();
    const full = 'C:/work/reports/quarterly_summary.md';
    vi.mocked(resolvePath).mockImplementation(async path => path === full
      ? { path: full, isDir: false, base: 'absolute' } : null);
    const f = fixture(['  Wrote C:/work/reports/quarterly_su', '  mmary.md with the results'], 36);
    const links = installTerminalPathLinks(f.terminal, () => undefined);
    expect((await f.links(1))?.map(link => link.text)).toEqual([full]);
    expect((await f.links(2))?.map(link => link.text)).toEqual([full]);
    links.dispose();
  });

  it('keeps each line\'s own links when the joined text is not an existing path', async () => {
    vi.mocked(resolvePath).mockReset();
    vi.mocked(resolvePath).mockImplementation(async path => path === 'src/lib/'
      ? { path: 'C:\\project\\src\\lib', isDir: true, base: 'cwd' } : null);
    const f = fixture(['Changed files are in src/lib/', 'Next, run the tests.']);
    const links = installTerminalPathLinks(f.terminal, () => 'C:/project');
    expect((await f.links(1))?.map(link => link.text)).toEqual(['src/lib/']);
    expect(await f.links(2)).toEqual([]);
    expect(resolvePath).toHaveBeenCalledWith('src/lib/Next', 'C:/project');
    links.dispose();
    // A line that doesn't end in a path is never joined to the next one.
    vi.mocked(resolvePath).mockClear();
    const prose = fixture(['A short sentence.', 'src/lib/']);
    const proseLinks = installTerminalPathLinks(prose.terminal, () => 'C:/project');
    expect((await prose.links(2))?.map(link => link.text)).toEqual(['src/lib/']);
    expect(resolvePath).toHaveBeenCalledTimes(1);
    proseLinks.dispose();
  });

  it('routes explicit file links through validated native opening', () => {
    vi.mocked(openPath).mockReset();
    const handler = localTerminalLinkHandler(() => 'C:/project');
    handler({ preventDefault() {} } as MouseEvent, 'file:///C:/My%20Files');
    expect(openPath).toHaveBeenCalledWith('file:///C:/My%20Files', 'C:/project');
    handler({ preventDefault() {} } as MouseEvent, 'javascript:alert(1)');
    expect(openPath).toHaveBeenCalledTimes(1);
  });
});

describe('copying an escaped terminal path', () => {
  const raw = String.raw`C:/Projects/mate\_health\_report/docs/JEV\_DECISION\_TREE.md`;
  it('copies the verified file path, with no Markdown escapes', async () => {
    vi.mocked(resolvePath).mockReset();
    const path = String.raw`C:\Projects\mate_health_report\docs\JEV_DECISION_TREE.md`;
    vi.mocked(resolvePath).mockResolvedValue({ path, isDir: false, base: 'absolute' });
    expect(await terminalSelectionForCopy(raw, 'C:/project')).toBe(path);
    expect(resolvePath).toHaveBeenCalledWith(raw, 'C:/project');
  });
  it('preserves a real underscore-prefixed directory and unknown paths', async () => {
    const literal = String.raw`C:\Projects\_private\report.md`;
    vi.mocked(resolvePath).mockResolvedValue({ path: literal, isDir: false, base: 'absolute' });
    expect(await terminalSelectionForCopy(literal)).toBe(literal);
    vi.mocked(resolvePath).mockResolvedValue(null);
    expect(await terminalSelectionForCopy(raw)).toBe(raw);
  });
  it.each([
    `Created ${raw}.`, `See ${raw} for details.`, `type "${raw}"`, `${raw}\nmore text`,
    'C:/Projects/mate_health_report/docs/JEV_DECISION_TREE.md', String.raw`https://example.com/my\_file`,
  ])('copies prose, commands, URLs and ordinary paths without rewriting or looking them up: %s', async text => {
    vi.mocked(resolvePath).mockClear();
    expect(await terminalSelectionForCopy(text)).toBe(text);
    expect(resolvePath).not.toHaveBeenCalled();
  });
});
