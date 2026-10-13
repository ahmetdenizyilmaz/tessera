import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, MousePointer2, PanelTop, RotateCcw, Settings2, X } from 'lucide-react';
import { browserDisplayMode, browserPanelShare, DEFAULT_BROWSER_LIVE_SHARE, type BrowserDisplayMode } from '../../lib/browserDisplay';
import { useBrowserViewStore } from '../../store/browserViewStore';

export function BrowserViewSettings({ site, title, surface }: { site: string; title: string; surface: RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false), [error, setError] = useState('');
  const [share, setShare] = useState<number | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const preference = useBrowserViewStore(s => s.preferences[site]);
  const id = useId();
  const document = trigger.current?.ownerDocument;
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (!open || !document?.defaultView) return;
    const view = document.defaultView;
    let frame = 0;
    const update = () => {
      if (!trigger.current || !surface.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      if (!anchor.width || !anchor.height || surface.current.closest('[inert]')) { setOpen(false); return; }
      const nextShare = browserPanelShare(surface.current);
      setShare(current => current === nextShare ? current : nextShare);
      const width = Math.min(320, view.innerWidth - 16), height = menu.current?.offsetHeight ?? 330;
      const left = Math.max(8, Math.min(anchor.right - width, view.innerWidth - width - 8));
      const top = Math.max(8, Math.min(anchor.bottom + 8, view.innerHeight - height - 8));
      setPosition(current => current.left === left && current.top === top ? current : { left, top });
      frame = view.requestAnimationFrame(update);
    };
    update();
    menu.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      view.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, document, surface]);

  const editable = share !== null && share > 0 && share < DEFAULT_BROWSER_LIVE_SHARE;
  const mode = share === null ? 'live' : browserDisplayMode(share, preference);
  const percent = (value: number) => `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
  const choose = (nextMode: BrowserDisplayMode | null) => {
    setError('');
    try {
      const currentShare = surface.current && browserPanelShare(surface.current);
      if (nextMode && (currentShare === null || !currentShare || currentShare >= DEFAULT_BROWSER_LIVE_SHARE)) return;
      useBrowserViewStore.getState().setPreference(site, nextMode ? { share: currentShare!, mode: nextMode } : null);
      close();
    } catch { setError('Could not save this setting. Please try again.'); }
  };

  return <>
    <button ref={trigger} type="button" title="Web panel settings" aria-label={`${title} view settings`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} className={open ? 'browser-settings-active' : ''}
      onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); setError(''); setOpen(value => !value); }}><Settings2 size={15} /></button>
    {open && document && createPortal(<div ref={menu} id={id} role="dialog" aria-label={`${title} view settings`} aria-describedby={`${id}-hint`}
      tabIndex={-1} className="browser-view-settings" data-browser-overlay style={position}
      onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <div className="browser-settings-heading"><div><strong>Small panel view</strong><span title={title}>{title}</span></div>
        <button type="button" aria-label="Close view settings" onClick={close}><X size={16} /></button></div>
      <p className="browser-settings-size">Current size <strong>{share === null ? 'Measuring…' : `${percent(share)} of workspace`}</strong></p>
      <div className="browser-settings-choices" role="group" aria-label="Behavior at the current size">
        <button type="button" disabled={!editable} aria-pressed={mode === 'live'} onClick={() => choose('live')}>
          <PanelTop size={19} /><span><strong>Live view</strong><small>Interact here and in larger panels.</small></span>{mode === 'live' && <Check size={16} />}</button>
        <button type="button" disabled={!editable} aria-pressed={mode === 'focus'} onClick={() => choose('focus')}>
          <MousePointer2 size={19} /><span><strong>Click to focus</strong><small>Show a focus card here and in smaller panels.</small></span>{mode === 'focus' && <Check size={16} />}</button>
      </div>
      <p id={`${id}-hint`} className="browser-settings-hint">{editable
        ? 'Choose how this app behaves at the current size. Focused panels always stay live.'
        : 'Panels at one-third of the workspace or larger always stay live. Make this panel smaller to change its behavior.'}</p>
      <div className="browser-settings-saved"><span>{preference ? `Live ${preference.mode === 'live' ? 'from' : 'above'} ${percent(preference.share)} of workspace` : 'Default: live from one-third of workspace'}<small>Saved for all {title} panels.</small></span>
        <button type="button" title="Reset to default size" aria-label="Reset to default size" disabled={!preference} onClick={() => choose(null)}><RotateCcw size={15} /></button></div>
      {error && <p className="browser-settings-error" role="alert">{error}</p>}
    </div>, document.body)}
  </>;
}
