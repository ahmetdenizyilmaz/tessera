import { open } from '@tauri-apps/plugin-shell';
import { notify } from './toast';

/** xterm's default URL pattern, except that a trailing `;` also ends the link,
 * like `.` or `,` do ("open https://example.com; then …"). */
export const TERMINAL_URL_REGEX = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\\^<>`]*[^\s"':;,.!?{}|\\\^~\[\]`()<>]/;

/** Both detected URLs and OSC 8 links go straight to the OS browser opener.
 * xterm's defaults use window.open (and confirm for OSC 8), which are browser
 * popup APIs rather than an external-browser handoff in a desktop webview. */
export function activateTerminalLink(event: MouseEvent, uri: string): void {
  event.preventDefault();
  // Preserve xterm's HTTP(S)-only policy, including for explicit hyperlinks.
  try {
    const url = new URL(uri);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  } catch {
    return;
  }
  void open(uri).catch(() => {
    notify('Could not open the link. Copy the URL into your browser to try again.');
  });
}
