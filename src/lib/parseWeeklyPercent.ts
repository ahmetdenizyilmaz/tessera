/**
 * Parse usage percentage from Claude CLI /status output.
 * Looks for patterns like "XX% of your weekly limit" or "XX.X% used".
 */
export function parseWeeklyPercent(text: string): number | null {
  // Match patterns like "45% of your weekly limit" or "45.5% used"
  const match = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:your\s+)?weekly|used)/i);
  if (match) {
    const value = parseFloat(match[1]);
    if (!isNaN(value) && value >= 0 && value <= 100) {
      return value;
    }
  }

  // Fallback: look for any percentage in status output
  const fallback = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (fallback) {
    const value = parseFloat(fallback[1]);
    if (!isNaN(value) && value >= 0 && value <= 100) {
      return value;
    }
  }

  return null;
}
