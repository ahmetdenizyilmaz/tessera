import { describe, expect, it, vi } from 'vitest';
import type { ILinkProvider, Terminal } from '@xterm/xterm';
import { openPath, resolvePath } from './openPath';
import { installTerminalPathLinks, localTerminalLinkHandler, terminalSelectionForCopy } from './terminalPaths';

vi.mock('./openPath', () => ({ openPath: vi.fn(), resolvePath: vi.fn() }));
vi.mock('./terminalLinks', () => ({ activateTerminalLink: vi.fn() }));

function fixture(text: string) {
  let provider: ILinkProvider;
  const cols = Math.max(80, text.length + 1);
  const line = { isWrapped: false, length: cols, getCell: (x: number) => ({ getWidth: () => 1, getChars: () => text[x] ?? '' }) };
  const terminal = { cols, buffer: { active: { getLine: (y: number) => y === 0 ? line : undefined, getNullCell: () => ({}) } },
    onWriteParsed: () => ({ dispose() {} }), onScroll: () => ({ dispose() {} }),
    registerLinkProvider: (p: ILinkProvider) => { provider = p; return { dispose: vi.fn() }; },
  } as unknown as Terminal;
  return { terminal, links: () => new Promise<Parameters<Parameters<ILinkProvider['provideLinks']>[1]>[0]>(resolve => provider.provideLinks(1, resolve)) };
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
