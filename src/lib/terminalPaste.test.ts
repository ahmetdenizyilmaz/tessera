import { expect, it } from 'vitest';
import { terminalPasteData } from './terminalPaste';

it('sends a paste as one bracketed block with terminal line breaks when the TUI asked for it', () => {
  expect(terminalPasteData('first line\r\nsecond\nthird\rÜnye 漢字', true)).toBe('\x1b[200~first line\rsecond\rthird\rÜnye 漢字\x1b[201~');
  expect(terminalPasteData('one line', true)).toBe('\x1b[200~one line\x1b[201~');
});
it('cannot be ended early by the pasted text itself', () => {
  expect(terminalPasteData('safe\x1b[201~\rrm -rf x\x1b[200~', true)).toBe('\x1b[200~safe\rrm -rf x\x1b[201~');
});
it('leaves the text untouched when bracketed paste is off', () => {
  expect(terminalPasteData('native paste\nsecond line', false)).toBe('native paste\nsecond line');
});
