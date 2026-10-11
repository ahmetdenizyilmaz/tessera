import { useId, useState } from 'react';
import { ArrowUpRight, ChevronDown, History, Layers, Puzzle, Search } from 'lucide-react';
import { useRecentPanelStore } from '../../store/recentPanelStore';
import { useInstanceStore } from '../../store/instanceStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useGroupStore } from '../../store/groupStore';
import { findRememberedPanel, openRecentPanel } from '../../lib/panelHistory';
import { ProviderIcon } from '../icons/ProviderIcons';
import type { RememberedPanel } from '../../types/panelHistory';

function provider(panel: RememberedPanel) {
  const config = panel.instance?.config;
  return config?.llmConfig?.provider ?? config?.agentProvider ?? (config ? 'claude' : null);
}
function detail(panel: RememberedPanel) {
  const name = provider(panel);
  const label = name === 'codex' ? 'Codex' : name === 'opencode' ? 'OpenCode' : name === 'antigravity' ? 'Antigravity'
    : name === 'claude' ? 'Claude' : name ? name[0].toUpperCase() + name.slice(1)
    : panel.group ? 'Group' : panel.plugin?.pluginName ?? 'Widget';
  return [label, panel.instance?.config.cwd || (panel.plugin ? 'App panel' : '')].filter(Boolean).join(' · ');
}

export function RecentPanels({ wizardId }: { wizardId: string }) {
  const entries = useRecentPanelStore(s => s.entries);
  // Open/closed badges also follow changes that have not reached the debounced MRU list yet.
  useLayoutStore(s => s.tabOrder);
  useGroupStore(s => s.groups);
  useInstanceStore(s => s.instances);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const filtered = entries.filter(entry => `${entry.saved.panel.name} ${detail(entry.saved.panel)}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="nsw-recents">
    <button type="button" className="nsw-recents-toggle" aria-expanded={expanded} aria-controls={listId}
      onClick={() => setExpanded(value => !value)} title="Show recently used panels">
      <History size={15} /><span>Recent panels</span>
      {entries.length > 0 && <span className="nsw-recents-count">{entries.length}</span>}
      <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
    </button>
    {expanded && <div id={listId} className="nsw-recents-content">
      {entries.length > 0 && <label className="nsw-recents-search">
        <Search size={13} /><input aria-label="Search recent panels" placeholder="Find a panel or provider…"
          value={query} onChange={event => setQuery(event.target.value)} />
      </label>}
      <div className="nsw-recents-list">
        {filtered.map(entry => {
          const panel = entry.saved.panel;
          const open = !!findRememberedPanel(panel);
          const icon = provider(panel);
          return <button type="button" className="nsw-recent-panel" key={entry.key}
            onClick={() => openRecentPanel(entry.saved, wizardId)}
            title={`${open ? 'Switch to' : 'Reopen'} ${panel.name}\n${detail(panel)}\nLast used ${new Date(entry.lastUsed).toLocaleString()}`}>
            <span className="nsw-recent-icon">{icon ? <ProviderIcon provider={icon === 'codex' ? 'openai' : icon} size={17} />
              : panel.group ? <Layers size={16} /> : <Puzzle size={16} />}</span>
            <span className="nsw-recent-text"><strong>{panel.name}</strong><small>{detail(panel)}</small></span>
            <span className={`nsw-recent-status${open ? ' is-open' : ''}`}>{open ? 'Open' : 'Reopen'}</span>
            <ArrowUpRight size={13} />
          </button>;
        })}
        {!filtered.length && <p className="nsw-recents-empty">{entries.length ? 'No matching panels.' : 'Panels you use will appear here, including recently closed panels.'}</p>}
      </div>
    </div>}
  </section>;
}
