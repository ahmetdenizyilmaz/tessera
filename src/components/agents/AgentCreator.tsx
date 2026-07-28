import { useState } from 'react';
import type { Agent } from '../../types/agent';
import { Save, X } from 'lucide-react';
import { agentTemplates } from '../../lib/agentTemplates';

interface AgentCreatorProps {
  agent?: Agent;
  onSave: (data: {
    name: string;
    description: string;
    system_prompt: string;
    model: string;
    tools: string;
  }) => void;
  onCancel: () => void;
}

const MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250514',
];

const AVAILABLE_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'NotebookEdit',
];

export default function AgentCreator({ agent, onSave, onCancel }: AgentCreatorProps) {
  const existingTools: string[] = agent?.tools ? (() => { try { return JSON.parse(agent.tools); } catch { return []; } })() : [];

  const [name, setName] = useState(agent?.name ?? '');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? '');
  const [model, setModel] = useState(agent?.model ?? MODELS[0]);
  const [selectedTools, setSelectedTools] = useState<string[]>(existingTools);

  const applyTemplate = (index: number) => {
    if (index < 0) return;
    const t = agentTemplates[index];
    setName(t.name);
    setDescription(t.description);
    setSystemPrompt(t.system_prompt);
    setModel(t.model);
    setSelectedTools([...t.tools]);
  };

  const toggleTool = (tool: string) => {
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name.trim(),
      description: description.trim(),
      system_prompt: systemPrompt,
      model,
      tools: JSON.stringify(selectedTools),
    });
  };

  const isValid = name.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {!agent && (
        <div className="form-group">
          <label className="form-label">Start from Template</label>
          <select
            className="form-select"
            defaultValue="-1"
            onChange={(e) => applyTemplate(Number(e.target.value))}
          >
            <option value="-1" disabled>Select a template...</option>
            {agentTemplates.map((t, i) => (
              <option key={t.name} value={i}>{t.name} — {t.description}</option>
            ))}
          </select>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Agent"
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input
          className="form-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this agent do?"
        />
      </div>

      <div className="form-group">
        <label className="form-label">System Prompt</label>
        <textarea
          className="form-textarea"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="You are a helpful assistant..."
          rows={6}
          style={{ minHeight: 120 }}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Model</label>
        <select className="form-select" value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Tools</label>
        <div className="form-tools-grid">
          {AVAILABLE_TOOLS.map((tool) => (
            <label key={tool} className="form-checkbox-label form-tool-item">
              <input
                type="checkbox"
                checked={selectedTools.includes(tool)}
                onChange={() => toggleTool(tool)}
              />
              {tool}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <X size={14} /> Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!isValid} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Save size={14} /> Save
        </button>
      </div>
    </form>
  );
}
