import { useState } from 'react';

interface SlashCommand {
  name: string;
  prompt: string;
}

export function SlashCommandsSettings() {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const addCommand = () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    setCommands([...commands, { name: newName.trim(), prompt: newPrompt.trim() }]);
    setNewName('');
    setNewPrompt('');
  };

  const removeCommand = (index: number) => {
    setCommands(commands.filter((_, i) => i !== index));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Custom Slash Commands</label>
        <p className="form-hint">Define /project:name commands with custom prompts.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {commands.map((cmd, i) => (
          <div key={i} style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>/project:{cmd.name}</span>
              <button onClick={() => removeCommand(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{cmd.prompt}</div>
          </div>
        ))}
        {commands.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>No custom slash commands</div>}
      </div>

      <div className="form-group">
        <input className="form-input" placeholder="Command name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ marginBottom: 6 }} />
        <textarea className="form-textarea" placeholder="Prompt template..." value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} rows={3} />
      </div>

      <button className="btn btn-sm btn-primary" onClick={addCommand} style={{ alignSelf: 'flex-start' }}>Add Command</button>
    </div>
  );
}
