import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, Link, Link2Off, Monitor, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { type LanStatus, useLanStore } from '../../store/lanStore';

interface PairingCode { code: string; expiresInSeconds: number }

export function NetworkSettings() {
  const status = useLanStore((s) => s.status);
  const globalError = useLanStore((s) => s.error);
  const [name, setName] = useState(status?.name ?? '');
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (status?.name) setName(status.name); }, [status?.name]);

  const apply = (next: LanStatus) => useLanStore.getState().setStatus(next);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (err) { setError(String(err)); } finally { setBusy(false); }
  };

  if (!status) return <div style={{ color: 'var(--text-muted)' }}>Loading local-network settings…</div>;

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
          Accept encrypted connections only from computers on the same private subnet. Tessera does not use an internet relay or open router ports.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Computer name</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
          <button className="btn btn-secondary" disabled={busy || !name.trim() || name.trim() === status.name} onClick={() => void run(async () => apply(await invoke<LanStatus>('lan_set_name', { name })))}>Save</button>
        </div>
      </div>

      {status.sharing && (
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
            <ShieldCheck size={15} color="#51cf66" /> Pair another computer
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
            Address: {status.addresses.length ? status.addresses.join(', ') : 'No private IPv4 interface found'}
          </div>
          <button className="btn btn-secondary" disabled={busy || status.addresses.length === 0} onClick={() => void run(async () => setPairingCode(await invoke<PairingCode>('lan_generate_pairing_code')))}>
            Generate one-time pairing code
          </button>
          {pairingCode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <code style={{ fontSize: 14, letterSpacing: 1, padding: '7px 9px', borderRadius: 5, background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>{pairingCode.code}</code>
              <button className="btn btn-secondary" title="Copy pairing code" onClick={() => navigator.clipboard.writeText(pairingCode.code)}><Copy size={13} /></button>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>single use · expires in 5 minutes</span>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
            <input className="form-input" placeholder="192.168.1.20:43721" value={address} onChange={(event) => setAddress(event.target.value)} />
            <input className="form-input" placeholder="One-time pairing code" value={code} onChange={(event) => setCode(event.target.value)} />
            <button className="btn btn-primary" disabled={busy || !address.trim() || !code.trim()} onClick={() => void run(async () => {
              apply(await invoke<LanStatus>('lan_pair', { address: address.trim(), code: code.trim() }));
              setAddress(''); setCode('');
            })}><Link size={13} /> Pair</button>
          </div>
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
        Windows may ask once for firewall access. Allow Tessera on Private networks only. Pairing shares panel names, status, recent transcripts, and message delivery; it does not expose files, shell commands, or approval controls.
      </p>
    </div>
  );
}
