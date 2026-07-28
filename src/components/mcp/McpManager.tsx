import React, { useEffect, useState } from 'react';
import { Server, Plus, Download } from 'lucide-react';
import { useMcpStore } from '../../store/mcpStore';
import { McpServerCard } from './McpServerCard';
import { McpImportDialog } from './McpImportDialog';
import type { McpServer, McpTransport } from '../../types/mcp';

interface AddFormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  url: string;
  scope: string;
}

const emptyForm: AddFormState = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '[]',
  env: '{}',
  url: '',
  scope: 'project',
};

export const McpManager: React.FC = () => {
  const { servers, loading, error, fetchServers, addServer, removeServer, toggleServer, updateServer } = useMcpStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);
  const [form, setForm] = useState<AddFormState>(emptyForm);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleEdit = (server: McpServer) => {
    setEditingServer(server);
    setForm({
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      scope: server.scope,
    });
    setShowAddForm(true);
  };

  const handleDelete = async (server: McpServer) => {
    await removeServer(server.id);
  };

  const handleToggle = async (server: McpServer, enabled: boolean) => {
    await toggleServer(server.id, enabled);
  };

  const handleSubmit = async () => {
    if (editingServer) {
      await updateServer(editingServer.id, form);
    } else {
      await addServer(form);
    }
    setForm(emptyForm);
    setEditingServer(null);
    setShowAddForm(false);
  };

  const handleCancel = () => {
    setForm(emptyForm);
    setEditingServer(null);
    setShowAddForm(false);
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 }}>
          <Server size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            MCP Servers
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowImport(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
          >
            <Download size={12} />
            Import
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              setEditingServer(null);
              setForm(emptyForm);
              setShowAddForm(true);
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: 11 }}
          >
            <Plus size={12} />
            Add
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {error && (
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 12,
              background: 'rgba(255,107,107,0.1)',
              border: '1px solid var(--error)',
              borderRadius: 6,
              color: 'var(--error)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {loading && servers.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>
            Loading servers...
          </p>
        )}

        {!loading && servers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <Server size={36} style={{ marginBottom: 12, opacity: 0.4 }} />
            <p style={{ fontSize: 14, marginBottom: 4 }}>No MCP servers configured</p>
            <p style={{ fontSize: 12 }}>
              Add a server manually or import from Claude Desktop.
            </p>
          </div>
        )}

        {/* Add / Edit Form */}
        {showAddForm && (
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 14,
            }}
          >
            <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {editingServer ? 'Edit Server' : 'Add Server'}
            </h4>

            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="my-server"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Transport</label>
              <select
                className="form-select"
                value={form.transport}
                onChange={(e) => setForm({ ...form, transport: e.target.value as McpTransport })}
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="streamable-http">streamable-http</option>
              </select>
            </div>

            {form.transport === 'stdio' ? (
              <>
                <div className="form-group">
                  <label className="form-label">Command</label>
                  <input
                    className="form-input"
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="npx -y @modelcontextprotocol/server-example"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Args (JSON array)</label>
                  <input
                    className="form-input"
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                    placeholder='["--flag", "value"]'
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Env (JSON object)</label>
                  <input
                    className="form-input"
                    value={form.env}
                    onChange={(e) => setForm({ ...form, env: e.target.value })}
                    placeholder='{"KEY": "value"}'
                  />
                </div>
              </>
            ) : (
              <div className="form-group">
                <label className="form-label">URL</label>
                <input
                  className="form-input"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="http://localhost:8080/mcp"
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Scope</label>
              <select
                className="form-select"
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
              >
                <option value="project">project</option>
                <option value="global">global</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={!form.name.trim()}>
                {editingServer ? 'Save Changes' : 'Add Server'}
              </button>
              <button className="btn btn-secondary" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Server List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {servers.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>

      <McpImportDialog isOpen={showImport} onClose={() => setShowImport(false)} />
    </div>
  );
};
