import React, { useState } from 'react';
import { Pencil, Trash2, Server as ServerIcon, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { McpServer } from '../../types/mcp';
import { useMcpStore } from '../../store/mcpStore';

interface McpServerCardProps {
  server: McpServer;
  onEdit: (server: McpServer) => void;
  onDelete: (server: McpServer) => void;
  onToggle: (server: McpServer, enabled: boolean) => void;
}

const statusColors: Record<string, string> = {
  connected: '#22c55e',
  disconnected: '#ef4444',
  unknown: '#a1a1aa',
};

export const McpServerCard: React.FC<McpServerCardProps> = ({
  server,
  onEdit,
  onDelete,
  onToggle,
}) => {
  const [testing, setTesting] = useState(false);
  const serverStatus = useMcpStore((s) => s.serverStatus[server.id]);
  const setServerStatus = useMcpStore((s) => s.setServerStatus);

  const handleTest = async () => {
    setTesting(true);
    try {
      await invoke('mcp_check_status', { id: server.id });
      setServerStatus(server.id, 'connected');
    } catch {
      setServerStatus(server.id, 'disconnected');
    }
    setTesting(false);
  };

  const dotColor = statusColors[serverStatus ?? 'unknown'];

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '10px 12px',
        opacity: server.enabled ? 1 : 0.6,
        transition: 'opacity 0.15s, border-color 0.15s',
      }}
    >
      {/* Top row: name + badges + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <ServerIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
            boxShadow: serverStatus === 'connected' ? `0 0 4px ${dotColor}` : 'none',
          }}
          title={serverStatus ?? 'unknown'}
        />
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {server.name}
        </span>
        {server.is_default && (
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 9999,
            background: 'var(--bg-surface)', color: 'var(--text-secondary)',
            fontWeight: 600, flexShrink: 0,
          }}>Default</span>
        )}
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 9999,
          border: '1px solid var(--border)', color: 'var(--text-secondary)',
          fontWeight: 600, flexShrink: 0,
        }}>
          {server.transport}
        </span>
      </div>

      {/* Bottom row: command/url + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 22 }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {server.transport === 'stdio' ? server.command : server.url}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button
            onClick={handleTest}
            disabled={testing}
            title="Test connection"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, border: 'none', borderRadius: 4,
              background: 'transparent', color: 'var(--accent)', cursor: 'pointer',
              opacity: testing ? 0.5 : 1,
            }}
          >
            <Zap size={13} />
          </button>
          <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={server.enabled}
              onChange={(e) => onToggle(server, e.target.checked)}
              style={{ display: 'none' }}
            />
            <div style={{
              width: 32, height: 18, borderRadius: 9999,
              background: server.enabled ? 'var(--accent)' : 'var(--border)',
              transition: 'background 0.2s',
              position: 'relative',
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: '50%',
                background: 'white', position: 'absolute',
                top: 2, left: server.enabled ? 16 : 2,
                transition: 'left 0.2s',
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }} />
            </div>
          </label>
          <button
            onClick={() => onEdit(server)}
            title="Edit"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, border: 'none', borderRadius: 4,
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => onDelete(server)}
            title="Delete"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, border: 'none', borderRadius: 4,
              background: 'transparent', color: 'var(--error)', cursor: 'pointer',
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
