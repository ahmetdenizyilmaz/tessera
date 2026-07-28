import { useMemo } from 'react';
import type { Checkpoint } from '../../types/checkpoint';
import { Plus, Minus, Edit3 } from 'lucide-react';

interface CheckpointDiffProps {
  checkpointA: Checkpoint;
  checkpointB: Checkpoint;
}

interface Message {
  role: string;
  content: string;
  [key: string]: unknown;
}

type DiffEntry =
  | { type: 'added'; message: Message; index: number }
  | { type: 'removed'; message: Message; index: number }
  | { type: 'modified'; before: Message; after: Message; index: number };

function parseMessages(snapshot: string): Message[] {
  try {
    return JSON.parse(snapshot);
  } catch {
    return [];
  }
}

function computeDiff(a: Message[], b: Message[]): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const maxLen = Math.max(a.length, b.length);

  for (let i = 0; i < maxLen; i++) {
    const msgA = a[i];
    const msgB = b[i];

    if (!msgA && msgB) {
      entries.push({ type: 'added', message: msgB, index: i });
    } else if (msgA && !msgB) {
      entries.push({ type: 'removed', message: msgA, index: i });
    } else if (JSON.stringify(msgA) !== JSON.stringify(msgB)) {
      entries.push({ type: 'modified', before: msgA, after: msgB, index: i });
    }
  }

  return entries;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

export default function CheckpointDiff({ checkpointA, checkpointB }: CheckpointDiffProps) {
  const diff = useMemo(() => {
    const msgsA = parseMessages(checkpointA.messages_snapshot);
    const msgsB = parseMessages(checkpointB.messages_snapshot);
    return computeDiff(msgsA, msgsB);
  }, [checkpointA, checkpointB]);

  if (diff.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        No differences between these checkpoints.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        Comparing <strong style={{ color: 'var(--text-secondary)' }}>{checkpointA.label}</strong> with{' '}
        <strong style={{ color: 'var(--text-secondary)' }}>{checkpointB.label}</strong>
        {' '}&mdash; {diff.length} difference{diff.length !== 1 ? 's' : ''}
      </div>

      {diff.map((entry) => (
        <div
          key={entry.index}
          style={{
            borderRadius: 6,
            border: `1px solid ${
              entry.type === 'added' ? 'var(--success)' :
              entry.type === 'removed' ? 'var(--error)' : 'var(--warning)'
            }`,
            background:
              entry.type === 'added' ? 'rgba(81, 207, 102, 0.06)' :
              entry.type === 'removed' ? 'rgba(255, 107, 107, 0.06)' : 'rgba(255, 212, 59, 0.06)',
            padding: '8px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            {entry.type === 'added' && <Plus size={14} color="var(--success)" />}
            {entry.type === 'removed' && <Minus size={14} color="var(--error)" />}
            {entry.type === 'modified' && <Edit3 size={14} color="var(--warning)" />}
            <span style={{
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              color: entry.type === 'added' ? 'var(--success)' :
                     entry.type === 'removed' ? 'var(--error)' : 'var(--warning)',
            }}>
              {entry.type} at index {entry.index}
            </span>
          </div>

          {entry.type === 'modified' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <div style={{
                padding: '4px 8px', borderRadius: 4,
                background: 'rgba(255, 107, 107, 0.08)', color: 'var(--error)',
                fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                - [{entry.before.role}] {truncate(String(entry.before.content), 200)}
              </div>
              <div style={{
                padding: '4px 8px', borderRadius: 4,
                background: 'rgba(81, 207, 102, 0.08)', color: 'var(--success)',
                fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                + [{entry.after.role}] {truncate(String(entry.after.content), 200)}
              </div>
            </div>
          ) : (
            <div style={{
              fontSize: 12, fontFamily: 'monospace',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              [{entry.message.role}] {truncate(String(entry.message.content), 300)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
