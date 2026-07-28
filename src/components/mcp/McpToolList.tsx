import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Wrench } from 'lucide-react';

interface McpToolListProps {
  serverId: number;
  serverName: string;
}

export const McpToolList: React.FC<McpToolListProps> = ({ serverName }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 12px',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={13} style={{ color: 'var(--text-muted)' }} />
        <span>Tools</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
          {serverName}
        </span>
      </button>

      {expanded && (
        <div style={{
          padding: '8px 12px 12px 36px',
          fontSize: 12,
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
        }}>
          Connect to server to discover tools
        </div>
      )}
    </div>
  );
};
