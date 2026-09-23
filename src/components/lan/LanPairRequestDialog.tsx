import { useCallback, useEffect, useState } from 'react';
import { Monitor, ShieldCheck } from 'lucide-react';
import { useLanStore } from '../../store/lanStore';

/**
 * Modal shown when another Tessera computer on the LAN asks to connect.
 * Nothing is shared until the person at this computer clicks Approve.
 */
export function LanPairRequestDialog() {
  const request = useLanStore((s) => s.status?.pendingRequests[0] ?? null);
  const waiting = useLanStore((s) => s.status?.pendingRequests.length ?? 0);
  const respond = useLanStore((s) => s.respondPairRequest);
  const [busy, setBusy] = useState(false);

  const answer = useCallback(async (accept: boolean) => {
    if (!request || busy) return;
    setBusy(true);
    try {
      await respond(request.requestId, accept);
    } finally {
      setBusy(false);
    }
  }, [request, busy, respond]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      void answer(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [request, answer]);

  if (!request) return null;

  return (
    <div className="dialog-overlay" style={{ zIndex: 3000 }}>
      <div className="dialog" style={{ maxWidth: 440 }} onClick={(event) => event.stopPropagation()}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Monitor size={18} /> Connection request
        </h2>
        <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>
          <strong>{request.name}</strong> ({request.address}) wants to connect to this computer over the local network.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
          Approving lets that computer view your open panels and send chat messages. Its user can also type
          directly into your running terminals, including commands and permission prompts. Only approve
          computers and people you trust with that access.
        </p>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
          Device fingerprint <code>{request.fingerprint}</code>. The same fingerprint is shown on {request.name} while it waits.
          {waiting > 1 && <div style={{ marginTop: 4 }}>{waiting - 1} more request{waiting > 2 ? 's are' : ' is'} waiting behind this one.</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" disabled={busy} onClick={() => void answer(false)}>Decline</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            autoFocus
            onClick={() => void answer(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ShieldCheck size={14} /> Approve
          </button>
        </div>
      </div>
    </div>
  );
}
