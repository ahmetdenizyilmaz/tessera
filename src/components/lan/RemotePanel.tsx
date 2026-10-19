import { useMemo, useState } from 'react';
import { History, Monitor, RefreshCw, SquareTerminal, WifiOff, X } from 'lucide-react';
import { ProviderIcon } from '../icons/ProviderIcons';
import { splitRemotePanelId, useLanStore } from '../../store/lanStore';
import { closePanel } from '../../lib/panelCleanup';
import { RemoteTerminalView } from './RemoteTerminalView';
import { RemoteConversation } from './RemoteConversation';
import { PanelShortcutBadge } from '../layout/PanelShortcutBadge';
import { PanelAppearanceButton } from '../appearance/BackgroundSettings';
import { PanelLockButton } from '../layout/PanelLockButton';
import { usePanelLayout } from '../windows/PanelWindowContext';
import './remotePanel.css';

export function RemotePanel({ instanceId }: { instanceId: string }) {
  const parsed = useMemo(() => splitRemotePanelId(instanceId), [instanceId]);
  const peer = useLanStore(s => s.status?.peers.find(p => p.deviceId === parsed?.deviceId));
  const panel = peer?.panels.find(p => p.id === parsed?.panelId);
  const useLayout = usePanelLayout();
  const focused = useLayout(s => s.focusedId === instanceId);
  const [history, setHistory] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isTerminal = panel?.kind === 'terminal';
  if (!parsed || !peer || !panel) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>Remote panel information is unavailable.</div>;
  return <div className="remote-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
    <div className="terminal-toolbar remote-panel-toolbar">
      <div className="remote-panel-heading">
        <ProviderIcon provider={panel.provider} size={16} />
        <div className="remote-panel-label" title={`${panel.name} · ${peer.name}${panel.model ? ` · ${panel.model}` : ''} · ${panel.status}`}>
          <div className="panel-title-with-shortcut" style={{ fontSize: 12, fontWeight: 600 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{panel.name}</span>
            <PanelShortcutBadge panelId={instanceId} />
          </div>
          <div className="remote-panel-metadata">{peer.name}{panel.model && ` · ${panel.model}`} · {panel.status}</div>
        </div>
      </div>
      <div className="remote-panel-actions">
        <span title={peer.connected ? 'Encrypted LAN connection active' : 'Remote computer offline'} style={{ color: peer.connected ? '#51cf66' : 'var(--text-muted)', display: 'flex' }}>
          {peer.connected ? <Monitor size={14} /> : <WifiOff size={14} />}
        </span>
        {isTerminal && <button className="btn btn-secondary" onClick={() => setHistory(!history)}
          title={history ? 'Show terminal' : 'Show conversation history'} aria-pressed={history}>
          {history ? <SquareTerminal size={14} /> : <History size={14} />}
        </button>}
        <PanelAppearanceButton panelId={instanceId} />
        <PanelLockButton panelId={instanceId} />
        <button className="btn btn-secondary" onClick={() => setRefreshKey(key => key + 1)} disabled={!peer.connected}
          title={isTerminal && !history ? 'Refresh terminal screen' : 'Refresh transcript'}><RefreshCw size={13} /></button>
        <button className="btn btn-secondary" onClick={event => { event.stopPropagation(); void closePanel(instanceId); }}
          onPointerDown={event => event.stopPropagation()} aria-label="Close remote panel locally" title="Close locally (keeps running on host)"><X size={13} /></button>
      </div>
    </div>
    {!peer.connected && <div className="remote-terminal-notice">{peer.name} is offline. Tessera will reconnect automatically when both computers are available.</div>}
    {isTerminal && !history ? <RemoteTerminalView deviceId={parsed.deviceId} panelId={parsed.panelId} connected={peer.connected}
      inputSupported={panel.terminalInput === true} streamSupported={panel.terminalStream === true}
      registryReady={peer.registryReady !== false} refreshKey={refreshKey} focused={focused} onHistory={() => setHistory(true)} />
      : <RemoteConversation deviceId={parsed.deviceId} panelId={parsed.panelId} connected={peer.connected}
          reachable={panel.reachable} busy={panel.busy} refreshKey={refreshKey} terminal={isTerminal} />}
  </div>;
}
