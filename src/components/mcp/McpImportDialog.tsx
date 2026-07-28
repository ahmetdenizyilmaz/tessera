import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useMcpStore } from '../../store/mcpStore';
import type { McpServer } from '../../types/mcp';

interface McpImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const McpImportDialog: React.FC<McpImportDialogProps> = ({ isOpen, onClose }) => {
  const { importFromClaudeDesktop, addServer, fetchServers } = useMcpStore();
  const [available, setAvailable] = useState<McpServer[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    importFromClaudeDesktop()
      .then((servers) => {
        setAvailable(servers);
        setSelected(new Set(servers.map((_, i) => i)));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [isOpen, importFromClaudeDesktop]);

  if (!isOpen) return null;

  const toggleItem = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      for (const idx of selected) {
        const s = available[idx];
        await addServer({
          name: s.name,
          transport: s.transport,
          command: s.command,
          args: s.args,
          env: s.env,
          url: s.url,
          scope: s.scope,
        });
      }
      await fetchServers();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3 className="dialog-title">Import from Claude Desktop</h3>
          <button className="dialog-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body">
          {loading && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Scanning Claude Desktop config...
            </p>
          )}

          {error && (
            <p style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{error}</p>
          )}

          {!loading && available.length === 0 && !error && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No MCP servers found in Claude Desktop configuration.
            </p>
          )}

          {!loading && available.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {available.map((srv, idx) => (
                <label
                  key={idx}
                  className="form-checkbox-label"
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg-elevated)',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(idx)}
                    onChange={() => toggleItem(idx)}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                      {srv.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {srv.transport} &mdash; {srv.transport === 'stdio' ? srv.command : srv.url}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={selected.size === 0 || importing || loading}
            onClick={handleImport}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={14} />
            {importing ? 'Importing...' : `Import ${selected.size} Server${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};
