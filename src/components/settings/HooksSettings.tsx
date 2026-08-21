import { useState, useEffect, useCallback } from 'react';

interface Hook {
  type: string;
  matcher?: string;
  command: string;
}

interface HookTemplate {
  name: string;
  type: string;
  matcher?: string;
  command: string;
  description: string;
}

const HOOK_TEMPLATES: HookTemplate[] = [
  { name: 'Log Tool Use', type: 'PostToolUse', command: 'echo "$(date): $TOOL_NAME" >> ~/.claude/tool_log.txt', description: 'Log all tool uses to a file' },
  { name: 'Block rm -rf', type: 'PreToolUse', matcher: 'Bash', command: 'if echo "$TOOL_INPUT" | grep -q "rm -rf"; then exit 1; fi', description: 'Prevent dangerous rm -rf commands' },
  { name: 'Notify on Complete', type: 'Stop', command: 'echo "Claude finished!" | notify-send "Tessera" 2>/dev/null || true', description: 'Desktop notification when Claude finishes' },
  { name: 'Block sudo', type: 'PreToolUse', matcher: 'Bash', command: 'if echo "$TOOL_INPUT" | grep -q "sudo"; then exit 1; fi', description: 'Prevent sudo commands' },
  { name: 'Auto-format on Write', type: 'PostToolUse', matcher: 'Write', command: 'npx prettier --write "$FILE_PATH" 2>/dev/null || true', description: 'Auto-format files after writing' },
];

const DANGEROUS_PATTERNS = ['rm -rf /', 'format c:', 'mkfs', ':(){:|:&};:', 'dd if=/dev/zero'];

const HOOK_TYPES = ['PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop'];

export function HooksSettings() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [newType, setNewType] = useState('PreToolUse');
  const [newMatcher, setNewMatcher] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useEffect(() => {
    loadHooks();
  }, []);

  const loadHooks = async () => {
    setLoading(true);
    try {
      const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
      const homeDir = await import('@tauri-apps/api/path').then(m => m.homeDir());
      const settingsPath = `${homeDir}.claude/settings.json`;

      if (await exists(settingsPath)) {
        const content = await readTextFile(settingsPath);
        const settings = JSON.parse(content);
        if (settings.hooks) {
          const parsed: Hook[] = [];
          for (const [type, hookList] of Object.entries(settings.hooks)) {
            if (Array.isArray(hookList)) {
              for (const h of hookList as any[]) {
                parsed.push({ type, matcher: h.matcher || '', command: h.command || '' });
              }
            }
          }
          setHooks(parsed);
        }
      }
    } catch (err) {
      console.warn('Failed to load hooks:', err);
    }
    setLoading(false);
  };

  const validateCommand = (cmd: string): string | null => {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (cmd.toLowerCase().includes(pattern.toLowerCase())) {
        return `Warning: Command contains potentially dangerous pattern "${pattern}"`;
      }
    }
    return null;
  };

  const addHook = useCallback(() => {
    if (!newCommand.trim()) return;

    const warning = validateCommand(newCommand);
    if (warning) {
      setValidationError(warning);
      return;
    }

    setHooks(prev => [...prev, { type: newType, matcher: newMatcher || undefined, command: newCommand.trim() }]);
    setNewCommand('');
    setNewMatcher('');
    setValidationError(null);
    setDirty(true);
  }, [newType, newMatcher, newCommand]);

  const addFromTemplate = useCallback((template: HookTemplate) => {
    setHooks(prev => [...prev, { type: template.type, matcher: template.matcher, command: template.command }]);
    setDirty(true);
  }, []);

  const removeHook = useCallback((index: number) => {
    setHooks(prev => prev.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  const saveHooks = useCallback(async () => {
    setSaving(true);
    try {
      const { readTextFile, writeTextFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');
      const homeDir = await import('@tauri-apps/api/path').then(m => m.homeDir());
      const claudeDir = `${homeDir}.claude`;
      const settingsPath = `${claudeDir}/settings.json`;

      // Ensure directory exists
      if (!(await exists(claudeDir))) {
        await mkdir(claudeDir, { recursive: true });
      }

      // Read existing settings
      let settings: Record<string, unknown> = {};
      if (await exists(settingsPath)) {
        try {
          const content = await readTextFile(settingsPath);
          settings = JSON.parse(content);
        } catch { /* start fresh */ }
      }

      // Build hooks object grouped by type
      const hooksObj: Record<string, Array<{ matcher?: string; command: string }>> = {};
      for (const hook of hooks) {
        if (!hooksObj[hook.type]) hooksObj[hook.type] = [];
        const entry: { matcher?: string; command: string } = { command: hook.command };
        if (hook.matcher) entry.matcher = hook.matcher;
        hooksObj[hook.type].push(entry);
      }

      settings.hooks = hooksObj;
      await writeTextFile(settingsPath, JSON.stringify(settings, null, 2));
      setDirty(false);
    } catch (err) {
      console.error('Failed to save hooks:', err);
    }
    setSaving(false);
  }, [hooks]);

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 16 }}>Loading hooks...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="form-group">
        <label className="form-label">Claude Hooks</label>
        <p className="form-hint">Shell commands that run in response to Claude events. Saved to ~/.claude/settings.json</p>
      </div>

      {/* Template bar */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {HOOK_TEMPLATES.map((t) => (
          <button
            key={t.name}
            className="btn btn-sm btn-secondary"
            onClick={() => addFromTemplate(t)}
            title={t.description}
            style={{ whiteSpace: 'nowrap', fontSize: 11, padding: '3px 8px' }}
          >
            + {t.name}
          </button>
        ))}
      </div>

      {/* Hook list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {hooks.map((hook, i) => (
          <div key={i} style={{
            background: 'var(--bg-elevated)',
            borderRadius: 6,
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer' }}
              onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
            >
              <span style={{
                fontSize: 11, padding: '1px 6px', borderRadius: 4,
                background: 'rgba(74,158,255,0.15)', color: 'var(--accent)',
                fontWeight: 600, whiteSpace: 'nowrap',
              }}>{hook.type}</span>
              {hook.matcher && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{hook.matcher}</span>
              )}
              <span style={{
                flex: 1, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{hook.command}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeHook(i); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
              >×</button>
            </div>
            {expandedIndex === i && (
              <div style={{ padding: '8px', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>Type</label>
                  <select
                    className="form-select"
                    value={hook.type}
                    onChange={(e) => {
                      const next = [...hooks];
                      next[i] = { ...next[i], type: e.target.value };
                      setHooks(next);
                      setDirty(true);
                    }}
                    style={{ fontSize: 12 }}
                  >
                    {HOOK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>Matcher (optional tool name pattern)</label>
                  <input
                    className="form-input"
                    value={hook.matcher ?? ''}
                    onChange={(e) => {
                      const next = [...hooks];
                      next[i] = { ...next[i], matcher: e.target.value || undefined };
                      setHooks(next);
                      setDirty(true);
                    }}
                    style={{ fontSize: 12 }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: 11 }}>Command</label>
                  <textarea
                    className="form-textarea"
                    value={hook.command}
                    onChange={(e) => {
                      const next = [...hooks];
                      next[i] = { ...next[i], command: e.target.value };
                      setHooks(next);
                      setDirty(true);
                    }}
                    style={{ fontSize: 12, fontFamily: 'monospace', minHeight: 60 }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        {hooks.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>
            No hooks configured. Click a template above or add one manually.
          </div>
        )}
      </div>

      {/* Add form */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select className="form-select" value={newType} onChange={(e) => setNewType(e.target.value)} style={{ width: 140 }}>
          {HOOK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          className="form-input"
          placeholder="Matcher (optional)"
          value={newMatcher}
          onChange={(e) => setNewMatcher(e.target.value)}
          style={{ width: 120 }}
        />
        <input
          className="form-input form-input-grow"
          placeholder="Shell command"
          value={newCommand}
          onChange={(e) => { setNewCommand(e.target.value); setValidationError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && addHook()}
        />
        <button className="btn btn-sm btn-primary" onClick={addHook}>Add</button>
      </div>

      {validationError && (
        <div style={{ fontSize: 12, color: 'var(--warning)', padding: '4px 8px', background: 'rgba(255,212,59,0.1)', borderRadius: 4 }}>
          {validationError}
          <button
            onClick={() => {
              setHooks(prev => [...prev, { type: newType, matcher: newMatcher || undefined, command: newCommand.trim() }]);
              setNewCommand('');
              setNewMatcher('');
              setValidationError(null);
              setDirty(true);
            }}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}
          >
            Add anyway
          </button>
        </div>
      )}

      {/* Save button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          className="btn btn-primary"
          onClick={saveHooks}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving...' : dirty ? 'Save Hooks' : 'Saved'}
        </button>
      </div>
    </div>
  );
}
