import { useState } from 'react';

interface PermissionRule {
  pattern: string;
  action: 'allow' | 'deny';
}

export function PermissionsSettings() {
  const [rules, setRules] = useState<PermissionRule[]>([
    { pattern: 'Read', action: 'allow' },
    { pattern: 'Glob', action: 'allow' },
    { pattern: 'Grep', action: 'allow' },
  ]);
  const [newPattern, setNewPattern] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');

  const addRule = () => {
    if (!newPattern.trim()) return;
    setRules([...rules, { pattern: newPattern.trim(), action: newAction }]);
    setNewPattern('');
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Tool Permission Rules</label>
        <p className="form-hint">Define which tools are auto-approved or denied.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rules.map((rule, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
            <span style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 4,
              background: rule.action === 'allow' ? 'rgba(81,207,102,0.15)' : 'rgba(255,107,107,0.15)',
              color: rule.action === 'allow' ? 'var(--success)' : 'var(--error)',
              fontWeight: 600,
            }}>
              {rule.action.toUpperCase()}
            </span>
            <span style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{rule.pattern}</span>
            <button
              onClick={() => removeRule(i)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="form-row">
        <select
          className="form-select"
          value={newAction}
          onChange={(e) => setNewAction(e.target.value as 'allow' | 'deny')}
          style={{ width: 100 }}
        >
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
        <input
          className="form-input form-input-grow"
          placeholder="Tool pattern (e.g. Bash, Read, Edit*)"
          value={newPattern}
          onChange={(e) => setNewPattern(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRule()}
        />
        <button className="btn btn-sm btn-primary" onClick={addRule}>Add</button>
      </div>
    </div>
  );
}
