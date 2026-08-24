import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../../store/settingsStore';
import { LLM_PROVIDERS } from '../../types/llmProviders';

export const LlmProviderSettings: React.FC = () => {
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  // API key states (masked display)
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [anthropicHasKey, setAnthropicHasKey] = useState(false);
  const [openaiHasKey, setOpenaiHasKey] = useState(false);
  const [openrouterHasKey, setOpenrouterHasKey] = useState(false);
  const [geminiHasKey, setGeminiHasKey] = useState(false);

  // Connection test states
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');
  const [lmstudioStatus, setLmstudioStatus] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');

  // Load existing key status on mount
  useEffect(() => {
    invoke<string | null>('llm_get_api_key', { provider: 'anthropic' }).then((key) => {
      if (key) setAnthropicHasKey(true);
    }).catch(() => {});
    invoke<string | null>('llm_get_api_key', { provider: 'openai' }).then((key) => {
      if (key) setOpenaiHasKey(true);
    }).catch(() => {});
    invoke<string | null>('llm_get_api_key', { provider: 'openrouter' }).then((key) => {
      if (key) setOpenrouterHasKey(true);
    }).catch(() => {});
    invoke<string | null>('llm_get_api_key', { provider: 'gemini' }).then((key) => {
      if (key) setGeminiHasKey(true);
    }).catch(() => {});
  }, []);

  const saveApiKey = useCallback(async (provider: string, key: string, setHas: (v: boolean) => void) => {
    if (!key.trim()) return;
    try {
      await invoke('llm_set_api_key', { provider, key: key.trim() });
      setHas(true);
    } catch (err) {
      console.error(`Failed to save ${provider} key:`, err);
    }
  }, []);

  const deleteApiKey = useCallback(async (provider: string, setHas: (v: boolean) => void, setKey: (v: string) => void) => {
    try {
      await invoke('llm_delete_api_key', { provider });
      setHas(false);
      setKey('');
    } catch (err) {
      console.error(`Failed to delete ${provider} key:`, err);
    }
  }, []);

  const testConnection = useCallback(async (
    provider: string,
    baseUrl: string,
    setStatus: (s: 'idle' | 'checking' | 'ok' | 'fail') => void,
  ) => {
    setStatus('checking');
    try {
      // The command resolves Ok(false) on a failed connection — the bool is
      // the verdict, not the promise settling.
      const ok = await invoke<boolean>('llm_check_connection', { provider, baseUrl });
      setStatus(ok ? 'ok' : 'fail');
    } catch {
      setStatus('fail');
    }
  }, []);

  const sty = {
    section: { marginBottom: 20 } as React.CSSProperties,
    label: { fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' } as React.CSSProperties,
    heading: { fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' } as React.CSSProperties,
    input: {
      width: '100%', padding: '6px 10px', border: '1px solid var(--border)',
      borderRadius: 4, background: 'var(--bg-primary)', color: 'var(--text-primary)',
      fontSize: 13, boxSizing: 'border-box' as const,
    },
    row: { display: 'flex', gap: 8, alignItems: 'center' } as React.CSSProperties,
    statusOk: { color: '#51cf66', fontSize: 12 },
    statusFail: { color: '#ff6b6b', fontSize: 12 },
  };

  return (
    <div style={{ padding: 4 }}>
      {/* Claude (API) — separate from the Claude Code CLI panels, which use
          your CLI login and need no key here */}
      <div style={sty.section}>
        <div style={sty.heading}>{LLM_PROVIDERS.anthropic.icon} Claude (API)</div>
        <div style={{ ...sty.label, marginBottom: 6 }}>
          Plain chat via the Anthropic API. Claude Code chat and terminal panels use
          your CLI login instead and ignore this key.
        </div>
        <label style={sty.label}>API Key</label>
        <div style={sty.row}>
          <input
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder={anthropicHasKey ? '•••• (saved)' : 'sk-ant-...'}
            style={{ ...sty.input, flex: 1 }}
          />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => saveApiKey('anthropic', anthropicKey, setAnthropicHasKey)}
            disabled={!anthropicKey.trim()}
          >
            Save
          </button>
          {anthropicHasKey && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 11 }}
              onClick={() => deleteApiKey('anthropic', setAnthropicHasKey, setAnthropicKey)}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* OpenAI */}
      <div style={sty.section}>
        <div style={sty.heading}>{LLM_PROVIDERS.openai.icon} OpenAI</div>
        <label style={sty.label}>API Key</label>
        <div style={sty.row}>
          <input
            type="password"
            value={openaiKey}
            onChange={(e) => setOpenaiKey(e.target.value)}
            placeholder={openaiHasKey ? '\u2022\u2022\u2022\u2022 (saved)' : 'sk-...'}
            style={{ ...sty.input, flex: 1 }}
          />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => saveApiKey('openai', openaiKey, setOpenaiHasKey)}
            disabled={!openaiKey.trim()}
          >
            Save
          </button>
          {openaiHasKey && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 11 }}
              onClick={() => deleteApiKey('openai', setOpenaiHasKey, setOpenaiKey)}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* OpenRouter */}
      <div style={sty.section}>
        <div style={sty.heading}>{LLM_PROVIDERS.openrouter.icon} OpenRouter</div>
        <div style={{ ...sty.label, marginBottom: 6 }}>
          One key for hundreds of models, including free ":free" routes. Also used
          when a Claude Code panel is routed through OpenRouter.
        </div>
        <label style={sty.label}>API Key</label>
        <div style={sty.row}>
          <input
            type="password"
            value={openrouterKey}
            onChange={(e) => setOpenrouterKey(e.target.value)}
            placeholder={openrouterHasKey ? '•••• (saved)' : 'sk-or-...'}
            style={{ ...sty.input, flex: 1 }}
          />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => saveApiKey('openrouter', openrouterKey, setOpenrouterHasKey)}
            disabled={!openrouterKey.trim()}
          >
            Save
          </button>
          {openrouterHasKey && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 11 }}
              onClick={() => deleteApiKey('openrouter', setOpenrouterHasKey, setOpenrouterKey)}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Gemini */}
      <div style={sty.section}>
        <div style={sty.heading}>{LLM_PROVIDERS.gemini.icon} Gemini</div>
        <label style={sty.label}>API Key</label>
        <div style={sty.row}>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder={geminiHasKey ? '\u2022\u2022\u2022\u2022 (saved)' : 'AIza...'}
            style={{ ...sty.input, flex: 1 }}
          />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => saveApiKey('gemini', geminiKey, setGeminiHasKey)}
            disabled={!geminiKey.trim()}
          >
            Save
          </button>
          {geminiHasKey && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 11 }}
              onClick={() => deleteApiKey('gemini', setGeminiHasKey, setGeminiKey)}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Ollama */}
      <div style={sty.section}>
        <div style={sty.heading}>{LLM_PROVIDERS.ollama.icon} Ollama</div>
        <label style={sty.label}>Base URL</label>
        <div style={sty.row}>
          <input
            value={settings.ollamaBaseUrl || ''}
            onChange={(e) => updateSettings({ ollamaBaseUrl: e.target.value })}
            placeholder={LLM_PROVIDERS.ollama.defaultBaseUrl}
            style={{ ...sty.input, flex: 1 }}
          />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => testConnection(
              'ollama',
              settings.ollamaBaseUrl || LLM_PROVIDERS.ollama.defaultBaseUrl,
              setOllamaStatus,
            )}
            disabled={ollamaStatus === 'checking'}
          >
            {ollamaStatus === 'checking' ? 'Testing...' : 'Test'}
          </button>
        </div>
        {ollamaStatus === 'ok' && <span style={sty.statusOk}>{'\u2713'} Connected</span>}
        {ollamaStatus === 'fail' && <span style={sty.statusFail}>{'\u2717'} Connection failed</span>}
      </div>

      {/* LM Studio */}
      <div style={sty.section}>
        <div style={sty.heading}>{LLM_PROVIDERS.lmstudio.icon} LM Studio</div>
        <label style={sty.label}>Base URL</label>
        <div style={sty.row}>
          <input
            value={settings.lmstudioBaseUrl || ''}
            onChange={(e) => updateSettings({ lmstudioBaseUrl: e.target.value })}
            placeholder={LLM_PROVIDERS.lmstudio.defaultBaseUrl}
            style={{ ...sty.input, flex: 1 }}
          />
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11 }}
            onClick={() => testConnection(
              'lmstudio',
              settings.lmstudioBaseUrl || LLM_PROVIDERS.lmstudio.defaultBaseUrl,
              setLmstudioStatus,
            )}
            disabled={lmstudioStatus === 'checking'}
          >
            {lmstudioStatus === 'checking' ? 'Testing...' : 'Test'}
          </button>
        </div>
        {lmstudioStatus === 'ok' && <span style={sty.statusOk}>{'\u2713'} Connected</span>}
        {lmstudioStatus === 'fail' && <span style={sty.statusFail}>{'\u2717'} Connection failed</span>}
      </div>
    </div>
  );
};
