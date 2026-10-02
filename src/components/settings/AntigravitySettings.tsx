import { useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { AntigravityOptionsForm } from '../antigravity/AntigravityOptionsForm';
export function AntigravitySettings() {
  const [value, setValue] = useState(() => ({ ...useSettingsStore.getState().settings.antigravityDefaults }));
  const [message, setMessage] = useState('');
  const save = () => {
    useSettingsStore.getState().updateSettings({ antigravityDefaults: { ...value } });
    setMessage('Defaults saved. Existing panels are unchanged.');
  };
  return <div><h4>Antigravity defaults</h4><p className="opencode-hint">Used by new Antigravity chat and terminal panels. Existing panels keep their own model, permissions and conversation; change those from the panel's menu.</p>
    <AntigravityOptionsForm value={value} onChange={next => { setValue(next); setMessage(''); }} />
    <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={save}>Save Antigravity defaults</button>
    {message && <p className="opencode-hint" role="status">{message}</p>}
  </div>;
}
