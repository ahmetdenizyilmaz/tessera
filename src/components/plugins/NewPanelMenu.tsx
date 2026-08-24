import { Folder, Puzzle } from 'lucide-react';
import { usePluginStore } from '../../store/pluginStore';
import { PanelViewPreview } from '../icons/PanelViewPreview';
import claudeIcon from '../../assets/claude-icon.ico';
import openaiIcon from '../../assets/openai-icon.png';
import geminiIcon from '../../assets/gemini-icon.png';
import ollamaIcon from '../../assets/ollama-icon.svg';
import lmstudioIcon from '../../assets/lmstudio-icon.png';
import openrouterIcon from '../../assets/openrouter-icon.svg';
import type { LlmProvider } from '../../types/instance';

// ─── Menu Item Definitions ──────────────────────────────────────────────────

const LLM_MENU_ITEMS: { id: 'claude' | LlmProvider; label: string; icon: string }[] = [
  { id: 'anthropic', label: 'Claude', icon: claudeIcon },
  { id: 'openai', label: 'ChatGPT', icon: openaiIcon },
  { id: 'openrouter', label: 'OpenRouter', icon: openrouterIcon },
  { id: 'gemini', label: 'Gemini', icon: geminiIcon },
  { id: 'ollama', label: 'Ollama', icon: ollamaIcon },
  { id: 'lmstudio', label: 'LM Studio', icon: lmstudioIcon },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface NewPanelMenuProps {
  onClose: () => void;
  onNewChat: (panelView?: 'chat' | 'terminal') => void;
  onNewChatSettings?: () => void;
  onNewLlmChat?: (provider?: Exclude<LlmProvider, 'claude'>) => void;
  onNewGroup: () => void;
  onNewPlugin: (pluginName: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NewPanelMenu({
  onClose,
  onNewChat,
  onNewChatSettings,
  onNewLlmChat,
  onNewGroup,
  onNewPlugin,
}: NewPanelMenuProps) {
  // Read plugin registry
  const registry = usePluginStore((s) => s.registry);
  const plugins = Array.from(registry.entries());

  return (
    <>
      {/* Backdrop to close menu on click outside */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onClick={onClose}
      />

      {/* Menu dropdown */}
      <div
        style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: 4,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '4px 0',
          minWidth: 250,
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
      >
        {/* ─── Section: BUILT-IN ──────────────────────────────────────── */}
        <div style={{
          padding: '4px 12px 2px',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Claude Code
        </div>
        <div className="menu-section-note">Uses your Claude Code CLI login</div>

        {/* Claude: pick chat or terminal at creation — the choice is fixed
            for the session's lifetime, so it belongs here, not in a toggle */}
        <div className="panel-view-menu-row">
          {(['chat', 'terminal'] as const).map((kind) => (
            <button
              key={kind}
              className="panel-view-menu-btn"
              onClick={() => { onClose(); onNewChat(kind); }}
              title={kind === 'chat' ? 'New Claude chat panel' : 'New Claude terminal panel'}
            >
              <PanelViewPreview kind={kind} size={52} />
              <span className="panel-view-menu-btn__label">
                <img src={claudeIcon} alt="" style={{ width: 12, height: 12, borderRadius: 2 }} />
                {kind === 'chat' ? 'Chat' : 'Terminal'}
              </span>
            </button>
          ))}
          {onNewChatSettings && (
            <button
              className="panel-view-menu-settings"
              onClick={(e) => { e.stopPropagation(); onClose(); onNewChatSettings(); }}
              title="Create with custom settings"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M6.5 1.5A.5.5 0 0 1 7 1h2a.5.5 0 0 1 .5.5v1.05a5 5 0 0 1 1.37.564l.74-.742a.5.5 0 0 1 .707 0l1.414 1.414a.5.5 0 0 1 0 .707l-.742.74A5 5 0 0 1 13.45 6.5H14.5a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-1.05a5 5 0 0 1-.564 1.37l.742.74a.5.5 0 0 1 0 .707l-1.414 1.414a.5.5 0 0 1-.707 0l-.74-.742A5 5 0 0 1 9.5 13.45v1.05a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5v-1.05a5 5 0 0 1-1.37-.564l-.74.742a.5.5 0 0 1-.707 0L2.27 12.214a.5.5 0 0 1 0-.707l.742-.74A5 5 0 0 1 2.55 9.5H1.5A.5.5 0 0 1 1 9V7a.5.5 0 0 1 .5-.5h1.05a5 5 0 0 1 .564-1.37l-.742-.74a.5.5 0 0 1 0-.707L3.786 2.27a.5.5 0 0 1 .707 0l.74.742A5 5 0 0 1 6.5 2.55V1.5zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" fill="currentColor"/>
              </svg>
            </button>
          )}
        </div>

        {/* Separator + API-key providers */}
        <div style={{ height: 1, background: 'var(--border)', margin: '6px 8px 4px' }} />
        <div style={{
          padding: '2px 12px 0',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Chat via API key
        </div>

        {/* Other LLM providers */}
        {LLM_MENU_ITEMS.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '4px 12px',
            }}
          >
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flex: 1,
                padding: '4px 0',
                background: 'none',
                border: 'none',
                color: 'var(--text-primary)',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
                borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onClick={() => {
                onClose();
                onNewLlmChat?.(item.id as Exclude<LlmProvider, 'claude'>);
              }}
            >
              <img src={item.icon} alt="" style={{ width: 18, height: 18, borderRadius: 4 }} />
              {item.label}
            </button>
          </div>
        ))}

        {/* Separator */}
        <div style={{
          height: 1,
          background: 'var(--border)',
          margin: '4px 8px',
        }} />

        {/* Group option */}
        <MenuItem
          icon={<Folder size={16} />}
          label="Group"
          onClick={() => { onClose(); onNewGroup(); }}
        />

        {/* ─── Section: PLUGINS ──────────────────────────────────────── */}
        {plugins.length > 0 && (
          <>
            <div style={{
              height: 1,
              background: 'var(--border)',
              margin: '4px 8px',
            }} />
            <div style={{
              padding: '6px 12px 2px',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Plugins
            </div>
            {plugins.map(([name, manifest]) => (
              <MenuItem
                key={name}
                icon={<Puzzle size={16} />}
                label={manifest.name}
                onClick={() => { onClose(); onNewPlugin(name); }}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}

// ─── Reusable Menu Item ─────────────────────────────────────────────────────

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '4px 12px',
      }}
    >
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 1,
          padding: '4px 0',
          background: 'none',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 13,
          cursor: 'pointer',
          textAlign: 'left',
          borderRadius: 4,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onClick={onClick}
      >
        <span style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          color: 'var(--accent)',
        }}>
          {icon}
        </span>
        {label}
      </button>
    </div>
  );
}
