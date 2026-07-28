import type { AgentRun } from '../../types/agent';
import { CheckCircle, XCircle, Clock, Loader, Ban } from 'lucide-react';

interface AgentOutputProps {
  run: AgentRun;
}

const STATUS_CONFIG: Record<AgentRun['status'], { icon: React.ReactNode; color: string; label: string }> = {
  pending:   { icon: <Clock size={14} />,       color: 'var(--text-muted)',  label: 'Pending' },
  running:   { icon: <Loader size={14} />,      color: 'var(--accent)',      label: 'Running' },
  completed: { icon: <CheckCircle size={14} />, color: 'var(--success)',     label: 'Completed' },
  failed:    { icon: <XCircle size={14} />,     color: 'var(--error)',       label: 'Failed' },
  cancelled: { icon: <Ban size={14} />,         color: 'var(--warning)',     label: 'Cancelled' },
};

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return '--';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function AgentOutput({ run }: AgentOutputProps) {
  const cfg = STATUS_CONFIG[run.status];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', borderRadius: 12,
          background: `${cfg.color}18`, color: cfg.color,
          fontSize: 12, fontWeight: 600,
        }}>
          {cfg.icon} {cfg.label}
        </span>

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Duration: {formatDuration(run.started_at, run.completed_at)}
        </span>
      </div>

      {/* Timestamps */}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
        <span>Started: {formatTime(run.started_at)}</span>
        <span>Completed: {formatTime(run.completed_at)}</span>
      </div>

      {/* Input */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Input
        </div>
        <pre style={{
          margin: 0, padding: '8px 12px', borderRadius: 6,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 120, overflowY: 'auto',
        }}>
          {run.input || '(empty)'}
        </pre>
      </div>

      {/* Output */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Output
        </div>
        <pre style={{
          margin: 0, padding: '8px 12px', borderRadius: 6,
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 300, overflowY: 'auto',
        }}>
          {run.output || (run.status === 'running' ? 'Waiting for output...' : '(no output)')}
        </pre>
      </div>
    </div>
  );
}
