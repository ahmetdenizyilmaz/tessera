/**
 * What to write to the PTY for pasted text.
 *
 * A TUI that enabled bracketed paste (DECSET 2004) expects a paste wrapped in
 * ESC[200~ … ESC[201~ with line breaks as CR, the way a terminal emulator sends
 * it. Without the wrapper every character is a keystroke and every line break
 * is Enter: the text is "typed" one character at a time and a multi-line paste
 * submits itself line by line.
 */
export function terminalPasteData(text: string, bracketed: boolean): string {
  if (!bracketed) return text;
  // Pasted text must not be able to end the paste early and smuggle in keystrokes.
  const body = text.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?|\n/g, '\r');
  return `\x1b[200~${body}\x1b[201~`;
}
