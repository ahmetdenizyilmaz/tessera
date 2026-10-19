export interface RemoteMessage { role: string; content: string; timestamp?: string | null }
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part : text(record(part)?.text)).filter(Boolean).join('\n');
  return '';
}

/** Codex read_panel returns turns with items; Claude returns chat messages.
 * Normalize only conversational items, not command/tool metadata or secrets
 * accidentally exposed by stringifying an entire provider response. */
export function remoteMessages(value: unknown): RemoteMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: RemoteMessage[] = [];
  const append = (item: RecordValue, timestamp?: unknown) => {
    const content = text(item.content) || text(item.text) || text(item.parts);
    if (!content) return;
    messages.push({ role: typeof item.role === 'string' ? item.role : item.type === 'userMessage' ? 'user' : 'assistant',
      content, timestamp: typeof item.timestamp === 'string' ? item.timestamp : typeof timestamp === 'string' ? timestamp : null });
  };
  for (const entry of value) {
    const message = record(entry);
    if (!message) continue;
    if (Array.isArray(message.items)) {
      for (const value of message.items) {
        const item = record(value);
        if (item?.type === 'userMessage' || item?.type === 'agentMessage') append(item, message.completedAt);
      }
    } else append(message);
  }
  return messages.slice(-100);
}
