import { useState } from 'react';

interface EnvVar {
  key: string;
  value: string;
}

export function EnvironmentSettings() {
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const addVar = () => {
    if (!newKey.trim()) return;
    setEnvVars([...envVars, { key: newKey.trim(), value: newValue }]);
    setNewKey('');
    setNewValue('');
  };

  const removeVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Custom Environment Variables</label>
        <p className="form-hint">These will be set when spawning Claude instances.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {envVars.map((env, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent)', minWidth: 100 }}>{env.key}</span>
            <span style={{ color: 'var(--text-muted)' }}>=</span>
            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{env.value}</span>
            <button onClick={() => removeVar(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        ))}
      </div>

      <div className="form-row">
        <input className="form-input" placeholder="KEY" value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ width: 120 }} />
        <input className="form-input form-input-grow" placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addVar()} />
        <button className="btn btn-sm btn-primary" onClick={addVar}>Add</button>
      </div>
    </div>
  );
}
