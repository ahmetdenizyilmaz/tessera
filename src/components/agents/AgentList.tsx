import { useEffect } from 'react';
import { useAgentStore } from '../../store/agentStore';
import type { Agent } from '../../types/agent';
import { Play, Pencil, Trash2, Bot, Upload, Download } from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

interface AgentListProps {
  onSelectAgent: (agent: Agent) => void;
  onRunAgent: (agent: Agent) => void;
}

export default function AgentList({ onSelectAgent, onRunAgent }: AgentListProps) {
  const { agents, loading, fetchAgents, deleteAgent, exportAgent, importAgent } = useAgentStore();

  const handleImport = async () => {
    const file = await open({ filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!file) return;
    const content = await readTextFile(file);
    await importAgent(content);
  };

  const handleExport = async (agent: Agent) => {
    const json = exportAgent(agent.id);
    if (!json) return;
    const path = await save({
      defaultPath: `${agent.name.replace(/\s+/g, '_')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    await writeTextFile(path, json);
  };

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  if (loading && agents.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        Loading agents...
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        <Bot size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
        <p>No agents created yet.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleImport}
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <Upload size={12} /> Import
        </button>
      </div>
      {agents.map((agent) => (
        <div
          key={agent.id}
          style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '10px 12px',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
              {agent.name}
            </span>
            <span style={{
              fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-primary)',
              padding: '1px 6px', borderRadius: 8,
            }}>
              {agent.model}
            </span>
          </div>

          {agent.description && (
            <p style={{
              margin: '0 0 8px', fontSize: 12, color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {agent.description}
            </p>
          )}

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onRunAgent(agent)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Play size={12} /> Run
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onSelectAgent(agent)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Pencil size={12} /> Edit
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => handleExport(agent)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Download size={12} /> Export
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => deleteAgent(agent.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
