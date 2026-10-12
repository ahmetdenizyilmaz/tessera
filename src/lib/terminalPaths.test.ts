import { describe, expect, it, vi } from 'vitest';
import type { ILinkProvider, Terminal } from '@xterm/xterm';
import { openPath, resolvePath } from './openPath';
import { installTerminalPathLinks, localTerminalLinkHandler } from './terminalPaths';

vi.mock('./openPath', () => ({ openPath: vi.fn(), resolvePath: vi.fn() }));
vi.mock('./terminalLinks', () => ({ activateTerminalLink: vi.fn() }));

function fixture(text: string) {
  let provider: ILinkProvider;
  const line = { isWrapped: false, length: 80, getCell: (x: number) => ({ getWidth: () => 1, getChars: () => text[x] ?? '' }) };
  const terminal = { cols: 80, buffer: { active: { getLine: (y: number) => y === 0 ? line : undefined, getNullCell: () => ({}) } },
    onWriteParsed: () => ({ dispose() {} }), onScroll: () => ({ dispose() {} }),
    registerLinkProvider: (p: ILinkProvider) => { provider = p; return { dispose: vi.fn() }; },
  } as unknown as Terminal;
  return { terminal, links: () => new Promise<Parameters<Parameters<ILinkProvider['provideLinks']>[1]>[0]>(resolve => provider.provideLinks(1, resolve)) };
}

describe('terminal filesystem links', () => {
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
