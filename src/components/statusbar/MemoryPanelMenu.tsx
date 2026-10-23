import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Moon, X } from 'lucide-react';
import { hibernateUnusedPanels, idlePanelIds, UNUSED_PANEL_MINUTES } from '../../lib/panelHibernation';

export function MemoryPanelMenu({ anchor, memoryLabel, onClose }: {
  anchor: HTMLButtonElement; memoryLabel: string; onClose: () => void;
}) {
  const titleId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const [count, setCount] = useState(() => idlePanelIds().length);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState({ left: 8, bottom: 36, width: 300 });
  const ownerDocument = anchor.ownerDocument;
  const ownerWindow = ownerDocument.defaultView!;

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(300, ownerWindow.innerWidth - 16);
      setPosition({ width, left: Math.max(8, Math.min(rect.left, ownerWindow.innerWidth - width - 8)),
        bottom: Math.max(8, ownerWindow.innerHeight - rect.top + 8) });
    };
    place();
    ownerWindow.addEventListener('resize', place);
    ownerDocument.addEventListener('scroll', place, true);
    return () => {
      ownerWindow.removeEventListener('resize', place);
      ownerDocument.removeEventListener('scroll', place, true);
    };
  }, [anchor, ownerDocument, ownerWindow]);

  useEffect(() => {
    menu.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      onClose(); anchor.focus();
    };
    const timer = ownerWindow.setInterval(() => setCount(idlePanelIds().length), 1000);
    ownerDocument.addEventListener('pointerdown', dismiss);
    ownerDocument.addEventListener('keydown', escape, true);
    return () => {
      ownerWindow.clearInterval(timer);
      ownerDocument.removeEventListener('pointerdown', dismiss);
      ownerDocument.removeEventListener('keydown', escape, true);
    };
  }, [anchor, onClose, ownerDocument, ownerWindow]);

  const hibernate = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(''); setFailed(false);
    try {
      const result = await hibernateUnusedPanels();
      const parts = [result.hibernated
        ? `Hibernated ${result.hibernated} panel${result.hibernated === 1 ? '' : 's'}.`
        : result.failed ? '' : 'No unused panels were ready to hibernate.'];
      if (result.skipped) parts.push(`Skipped ${result.skipped} because their state changed.`);
      if (result.failed) parts.push(`${result.failed} could not hibernate. Please try again.`);
      setMessage(parts.filter(Boolean).join(' ')); setFailed(result.failed > 0);
    } catch {
      setMessage('Could not hibernate unused panels. Please try again.'); setFailed(true);
    } finally {
      pending.current = false; setBusy(false); setCount(idlePanelIds().length);
    }
  };

  return createPortal(<div ref={menu} className="memory-panel-menu" role="dialog" tabIndex={-1}
    aria-labelledby={titleId} style={position}>
    <div className="memory-panel-menu-heading">
      <strong id={titleId}>Memory</strong>
      <button type="button" className="memory-panel-menu-close" aria-label="Close memory menu"
        onClick={() => { onClose(); anchor.focus(); }}><X size={14} /></button>
    </div>
    <div className="memory-panel-menu-usage">{memoryLabel}</div>
    <button type="button" className="memory-panel-hibernate" disabled={busy || count === 0} onClick={hibernate}>
      {busy ? <LoaderCircle size={16} className="memory-panel-spinner" /> : <Moon size={16} />}
      <span>{busy ? 'Hibernating…' : 'Hibernate unused panels'}</span>
      {!busy && count > 0 && <span className="memory-panel-count">{count}</span>}
    </button>
    <p>{count > 0 ? `${count} panel${count === 1 ? '' : 's'} idle for ${UNUSED_PANEL_MINUTES}+ minutes.`
      : `No panels idle for ${UNUSED_PANEL_MINUTES}+ minutes.`} Active tasks, drafts and focused panels stay awake.</p>
    <p className="memory-panel-menu-hint">Only time while Tessera is open counts.</p>
    {message && <div className={`memory-panel-result${failed ? ' is-error' : ''}`} role={failed ? 'alert' : 'status'}>{message}</div>}
  </div>, ownerDocument.body);
}
