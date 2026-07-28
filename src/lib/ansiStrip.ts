/**
 * Handle carriage return (\r) overwrite behavior.
 * Terminal \r means "return to column 0" and overwrites the line.
 * Spinners use this for animation.
 */
export function handleCarriageReturn(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const parts = line.split('\r');
      if (parts.length <= 1) return line;
      // Keep the last segment (the overwritten result)
      return parts[parts.length - 1];
    })
    .join('\n');
}

/**
 * Strip non-color CSI sequences from PTY output, keeping SGR (color) codes.
 * Also handle CR overwrite and strip control characters.
 */
export function cleanPtyOutputForChat(raw: string): string {
  // Handle carriage return overwriting
  let text = handleCarriageReturn(raw);

  // Strip non-SGR CSI sequences (keep \x1b[...m which are colors)
  // CSI = \x1b[ followed by parameter bytes (0x30-0x3f), intermediate bytes (0x20-0x2f),
  // and a final byte (0x40-0x7e). SGR final byte is 'm'.
  text = text.replace(/\x1b\[[0-9;]*[A-LN-Za-ln-z]/g, '');

  // Strip OSC sequences: \x1b] ... (ST = \x1b\\ or \x07)
  text = text.replace(/\x1b\].*?(?:\x1b\\|\x07)/g, '');

  // Strip other escape sequences (not CSI/SGR)
  text = text.replace(/\x1b[^[\]m][^\x1b]*/g, '');

  // Strip remaining control characters (except \n, \t, and ESC for color)
  text = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');

  return text;
}

// Patterns to filter from assistant display
const TUI_LINE_FILTERS: RegExp[] = [
  /^[╭╰│┌└├┤┬┴┼]/,                     // Box drawing at line start
  /^[─━═]{2,}/,                          // Horizontal rules
  /bypass\s*permissions/i,               // Permission bypass prompt
  /shift\+tab.*cycle/i,                  // Tab cycling hint
  /dangerous.*tool/i,                    // Dangerous tool warning
  /approve.*deny/i,                      // Approve/deny prompt
  /trust.*dialog/i,                      // Trust dialog
  /\(shift\+tab/i,                       // Shift+tab hint
  /welcome to claude code/i,             // Welcome message
  /\/help for help/i,                    // Help hint
  /\/status for your plan/i,             // Status hint
  /^\s*⏵\s*$/,                          // Bare prompt marker
  /^\s*❯\s*$/,                          // Bare prompt marker (alt)
  /\(\d+s\)\s*$/,                        // Spinner lines ending with (Xs)
  /^Done\(/,                             // Done(...) summary
  /\[Request interrupted\]/,             // Interrupted message
  /compacting conversation/i,            // Compaction message
  /Enter to select/i,                    // TUI selection prompt
  /Tab\/Arrow keys/i,                    // Navigation hint
  /^[←☐✔]/,                            // Tab bar navigation chars
];

/**
 * Clean assistant content for chat display.
 * Split lines, strip prompt markers, filter TUI lines,
 * remove bare prompts, collapse blank lines.
 */
export function cleanAssistantContent(text: string): string {
  const lines = text.split('\n');
  const cleaned: string[] = [];
  let prevBlank = false;

  for (const line of lines) {
    // Strip prompt markers
    let l = line.replace(/⏵\s*/g, '').replace(/\s*❯\s*/g, '');

    // Check against TUI line filters
    const stripped = l.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (TUI_LINE_FILTERS.some((re) => re.test(stripped))) {
      continue;
    }

    // Collapse blank lines
    if (stripped === '') {
      if (prevBlank) continue;
      prevBlank = true;
    } else {
      prevBlank = false;
    }

    cleaned.push(l);
  }

  // Remove leading/trailing blank lines
  while (cleaned.length > 0 && cleaned[0].trim() === '') cleaned.shift();
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();

  return cleaned.join('\n');
}
