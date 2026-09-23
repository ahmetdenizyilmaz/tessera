import { useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { OpenCodeOptionsForm } from '../opencode/OpenCodeOptionsForm';
import { isCompatibleProvider, openCodeEndpoint } from '../../lib/opencodeConfig';
export function OpenCodeSettings() {
  const [value, setValue] = useState(() => ({ ...useSettingsStore.getState().settings.openCodeDefaults }));
  const [message, setMessage] = useState('');
  const save = () => {
    try {
      if (isCompatibleProvider(value.provider)) openCodeEndpoint(value.provider, value.baseUrl);
      useSettingsStore.getState().updateSettings({ openCodeDefaults: { ...value } });
      setMessage('Defaults saved. Existing panels are unchanged.');
    } catch (e) { setMessage(String(e)); }
  };
  return <div><h4>OpenCode defaults</h4><p className="opencode-hint">Used by new chat and terminal panels. Existing panels retain their provider, model, endpoint, and permissions.</p>
    <OpenCodeOptionsForm value={value} onChange={next => { setValue(next); setMessage(''); }} />
    <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={save}>Save OpenCode defaults</button>
    {message && <p className="opencode-hint" role="status">{message}</p>}
  </div>;
}
