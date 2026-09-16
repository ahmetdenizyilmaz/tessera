import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link2Off, Loader2, Monitor, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { type LanStatus, useLanStore } from '../../store/lanStore';

export function NetworkSettings() {
  const status = useLanStore((s) => s.status);
  const globalError = useLanStore((s) => s.error);
  const outgoing = useLanStore((s) => s.outgoing);
  const requestPair = useLanStore((s) => s.requestPair);
  const respond = useLanStore((s) => s.respondPairRequest);
  const [name, setName] = useState(status?.name ?? '');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (status?.name) setName(status.name); }, [status?.name]);

  const apply = (next: LanStatus) => useLanStore.getState().setStatus(next);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (err) { setError(String(err)); } finally { setBusy(false); }
  };

  const sendRequest = async () => {
    if (!address.trim() || outgoing) return;
    setError(null);
    const deviceId = await requestPair(address);
    if (deviceId) setAddress('');
    else setError(useLanStore.getState().error);
  };

  if (!status) return <div style={{ color: 'var(--text-muted)' }}>Loading local-network settings…</div>;

  const ownAddresses = status.addresses.map((a) => a.split(':')[0]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="form-group">
        <label className="form-checkbox-label">
          <input
            type="checkbox"
            checked={status.sharing}
            disabled={busy}
            onChange={(event) => void run(async () => apply(await invoke<LanStatus>('lan_set_sharing', { enabled: event.target.checked })))}
          />
          Share on local network
        </label>
        <p className="form-hint">
          Lets other computers on the same private subnet send connection requests. Every request has to be approved here before anything is shared. Tessera does not use an internet relay or open router ports.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Computer name</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
          <button className="btn btn-secondary" disabled={busy || !name.trim() || name.trim() === status.name} onClick={() => void run(async () => apply(await invoke<LanStatus>('lan_set_name', { name })))}>Save</button>
        </div>
      </div>

      <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
          <ShieldCheck size={15} color="#51cf66" /> Connect another computer
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          This computer: {ownAddresses.length ? ownAddresses.join(', ') : 'No private IPv4 interface found'}
          {' · '}fingerprint <code>{status.fingerprint}</code>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            style={{ flex: 1 }}
            placeholder="Other computer's IP, e.g. 192.168.1.20"
            value={address}
            disabled={!!outgoing}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void sendRequest(); }}
          />
          <button
            className="btn btn-primary"
            disabled={busy || !address.trim() || !!outgoing}
            onClick={() => void sendRequest()}
            style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {outgoing ? <><Loader2 size={13} className="spin" /> Waiting…</> : <><Send size={13} /> Send request</>}
          </button>
        </div>
        {outgoing && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
            Waiting for someone on <strong>{outgoing}</strong> to click Approve (up to two minutes).
          </div>
        )}
        <p className="form-hint" style={{ marginBottom: 0 }}>
          The other computer shows an approval prompt. Once approved, its open panels appear as a subgroup and both computers reconnect automatically from then on.
        </p>
      </div>

      {status.pendingRequests.length > 0 && (
        <div>
          <div className="form-label" style={{ marginBottom: 8 }}>Incoming requests</div>
          {status.pendingRequests.map((request) => (
            <div key={request.requestId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', border: '1px solid var(--accent)', borderRadius: 7, marginBottom: 6 }}>
              <Monitor size={16} color="var(--accent)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{request.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{request.address} · fingerprint {request.fingerprint}</div>
              </div>
              <button className="btn btn-secondary" onClick={() => void respond(request.requestId, false)}>Decline</button>
              <button className="btn btn-primary" onClick={() => void respond(request.requestId, true)}>Approve</button>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="form-label" style={{ marginBottom: 8 }}>Paired computers</div>
        {status.peers.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No paired computers.</div>
        ) : status.peers.map((peer) => (
          <div key={peer.deviceId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, marginBottom: 6 }}>
            <Monitor size={16} color={peer.connected ? '#51cf66' : 'var(--text-muted)'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{peer.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{peer.address} · {peer.connected ? `connected · ${peer.panels.length} panels` : 'offline'}</div>
            </div>
            {peer.connected ? (
              <button className="btn btn-secondary" title="Disconnect" disabled={busy} onClick={() => void run(async () => apply(await invoke<LanStatus>('lan_disconnect', { deviceId: peer.deviceId })))}><Link2Off size={13} /></button>
            ) : (
              <button className="btn btn-secondary" title="Reconnect" disabled={busy || !status.sharing} onClick={() => void run(async () => apply(await invoke<LanStatus>('lan_connect', { deviceId: peer.deviceId })))}><RefreshCw size={13} /></button>
            )}
            <button className="btn btn-secondary" title="Forget this computer and remove its subgroup" disabled={busy} onClick={() => void run(async () => apply(await invoke<LanStatus>('lan_forget', { deviceId: peer.deviceId })))}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      {(error || globalError) && <div style={{ color: '#ff6b6b', fontSize: 11 }}>{error || globalError}</div>}
      <p className="form-hint">
        Windows may ask once for firewall access. Allow Tessera on Private networks only. A paired computer sees panel names, status, and recent transcripts and can send messages; it cannot access files, shell commands, or approval controls.
      </p>
    </div>
  );
}
