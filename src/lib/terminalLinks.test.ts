import { describe, expect, it, vi } from 'vitest';
import { Terminal, type ILink, type ILinkProvider } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TERMINAL_URL_REGEX } from './terminalLinks';

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('./toast', () => ({ notify: vi.fn() }));

async function linksIn(text: string) {
  const term = new Terminal({ cols: 80, rows: 4, allowProposedApi: true });
  let provider!: ILinkProvider;
  vi.spyOn(term, 'registerLinkProvider').mockImplementation(registered => { provider = registered; return { dispose() {} }; });
  term.loadAddon(new WebLinksAddon(() => {}, { urlRegex: TERMINAL_URL_REGEX }));
  await new Promise<void>(resolve => term.write(text, resolve));
  const links = await new Promise<ILink[]>(resolve => provider.provideLinks(1, found => resolve(found ?? [])));
  term.dispose();
  return links.map(link => link.text);
}

describe('terminal URL links', () => {
  it('leave a trailing semicolon out of the link, like other punctuation', async () => {
    expect(await linksIn('open https://asistant.ady.com.tr; then https://ady.com.tr.')).toEqual(['https://asistant.ady.com.tr', 'https://ady.com.tr']);
  });

  it('keep semicolons inside a URL', async () => {
    expect(await linksIn('https://example.com/a;jsessionid=1?x=1;y=2;')).toEqual(['https://example.com/a;jsessionid=1?x=1;y=2']);
  });
});
