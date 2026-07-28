import type { StreamEvent } from '../types/stream';

export function parseLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as StreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}
