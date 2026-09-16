import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Loader2, Monitor, RefreshCw, Send } from 'lucide-react';
import { type LanStatus, revealRemoteGroup, useLanStore } from '../../store/lanStore';
import { useGroupStore } from '../../store/groupStore';

interface LanConnectStepProps {
  /** Called once the other computer approved and its subgroup is in place. */
  onConnected: () => void;
}

/**
 * Wizard step for "Local PC": ask for the other computer's IP, send a
 * connection request, and wait for the person there to approve it.
 */
export function LanConnectStep({ onConnected }: LanConnectStepProps) {
  const status = useLanStore((s) => s.status);
  const outgoing = useLanStore((s) => s.outgoing);
  const requestPair = useLanStore((s) => s.requestPair);
  const groups = useGroupStore((s) => s.groups);
  const [address, setAddress] = useState(outgoing ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!address.trim() || outgoing) return;
    setError(null);
    const deviceId = await requestPair(address);
    if (deviceId) {
      onConnected();
      revealRemoteGroup(deviceId);
    } else {
      setError(useLanStore.getState().error ?? 'The connection could not be made.');
    }
  };

  const open = (deviceId: string) => {
    onConnected();
    revealRemoteGroup(deviceId);
  };

  const reconnect = async (deviceId: string) => {
    setBusyPeer(deviceId);
    setError(null);
    try {
      useLanStore.getState().setStatus(await invoke<LanStatus>('lan_connect', { deviceId }));
      // The subgroup sync is debounced; give it a beat before revealing.
      setTimeout(() => open(deviceId), 120);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyPeer(null);
    }
  };

  const hasGroup = (deviceId: string) => [...groups.values()].some((g) => g.remotePeerId === deviceId);
  const ownAddresses = status?.addresses.map((a) => a.split(':')[0]) ?? [];

  return (
    <div className="nsw-step">
      <div className="nsw-step__label">2 · Other computer</div>
      <p className="form-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        Enter the LAN IP address of a computer running Tessera. The person there gets an approval prompt.
        Once they approve, their open Claude and Codex panels appear here as a subgroup.
      </p>
      <div className="form-row" style={{ gap: 8 }}>
        <input
          ref={inputRef}
          className="form-input form-input-grow"
          value={address}
          disabled={!!outgoing}
          placeholder="192.168.1.20"
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
        />
        <button
          className="btn btn-primary"
          disabled={!address.trim() || !!outgoing}
          onClick={() => void submit()}
          style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {outgoing ? <><Loader2 size={14} className="spin" /> Waiting…</> : <><Send size={14} /> Send request</>}
        </button>
      </div>
      {outgoing && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Waiting for someone on <strong>{outgoing}</strong> to click Approve (up to two minutes).
          {status?.fingerprint && <> Your fingerprint: <code>{status.fingerprint}</code></>}
        </div>
      )}
      {error && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--error, #ff6b6b)', lineHeight: 1.5 }}>{error}</div>}
      {status && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          This computer: {ownAddresses.length ? ownAddresses.join(', ') : 'no private IPv4 address found'} · {status.name}
          {!status.sharing && ' · sharing is off and turns on when you send a request'}
        </div>
      )}

      {status && status.peers.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="form-label" style={{ marginBottom: 6 }}>Paired computers</div>
          {status.peers.map((peer) => (
            <div
              key={peer.deviceId}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4 }}
            >
              <Monitor size={14} color={peer.connected ? '#51cf66' : 'var(--text-muted)'} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{peer.name}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>
                  {peer.address.split(':')[0]} · {peer.connected ? 'online' : 'offline'}
                </span>
              </div>
              {peer.connected || hasGroup(peer.deviceId) ? (
                <button className="btn btn-secondary btn-sm" onClick={() => open(peer.deviceId)}>Open</button>
              ) : (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busyPeer === peer.deviceId}
                  onClick={() => void reconnect(peer.deviceId)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <RefreshCw size={12} className={busyPeer === peer.deviceId ? 'spin' : ''} /> Reconnect
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
