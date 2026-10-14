import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { usePluginStore } from '../../store/pluginStore';
import { webAppIcon } from '../../lib/webApps';
import { removePlugin } from '../../lib/pluginActions';
import { PluginIcon } from '../icons/PluginIcon';
import { usePanelWindow } from '../windows/PanelWindowContext';
import './addons.css';

export function AddonManager({ onClose, initialName }: { onClose: () => void; initialName?: string }) {
  const ownerDocument = usePanelWindow().document ?? document;
  const registry = usePluginStore(s => s.registry);
  const instances = usePluginStore(s => s.instances);
  const removed = usePluginStore(s => s.removedPlugins);
  const [selected, setSelected] = useState(initialName ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null), headingId = useId();
  useEffect(() => {
    const previous = ownerDocument.activeElement as HTMLElement | null;
    dialog.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [ownerDocument]);
  const activeApps = [...registry.values()].filter(app => !removed.has(app.name));
  const removedApps = [...registry.values()].filter(app => removed.has(app.name));
  const openCount = (name: string) => [...instances.values()].filter(instance => instance.pluginName === name).length;
  const remove = async (name: string) => {
    setError(''); setBusy(true);
    try { await removePlugin(name); setSelected(''); }
    catch { setError('Could not finish removing this add-on. Please try again.'); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="dialog-overlay" data-browser-overlay onPointerDown={event => event.stopPropagation()}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="addon-manager" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); }
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), summary')].filter(el => el.getClientRects().length);
          const first = controls[0], last = controls.at(-1), focused = ownerDocument.activeElement;
          if (event.shiftKey && (focused === first || focused === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (focused === last || focused === dialog.current)) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><div><h2 id={headingId}>Manage add-ons</h2><p>Plugins and web players</p></div>
        <button type="button" className="addon-close" aria-label="Close add-on manager" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      <p className="addon-hint">Removing an add-on closes its open panels and removes it from launch menus. Saved logins and add-on data are kept.</p>
      <div className="addon-list">
        {activeApps.map(app => <div className="addon-row" key={app.name} data-addon-name={app.name}>
          <div className="addon-info"><PluginIcon icon={webAppIcon(app)} size={23}/><span><strong>{app.defaultTitle}</strong>
            <small>{app.browserSite ? 'Web player' : app.builtin ? 'Built-in plugin' : 'Plugin'} · {openCount(app.name)} open</small></span>
            <button type="button" className="btn btn-secondary btn-sm addon-remove" aria-label={`Remove ${app.defaultTitle}`} disabled={busy}
              onClick={() => { setError(''); setSelected(app.name); }}><Trash2 size={14}/>Remove</button></div>
          {selected === app.name && <div className="addon-confirm"><p>Remove <strong>{app.defaultTitle}</strong>?{openCount(app.name) > 0 && ` This will close ${openCount(app.name)} open ${openCount(app.name) === 1 ? 'panel' : 'panels'}.`}</p>
            <div><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setSelected('')}>Cancel</button>
              <button type="button" className="btn btn-sm addon-confirm-remove" aria-label={`Confirm removal of ${app.defaultTitle}`} disabled={busy} onClick={() => void remove(app.name)}>{busy ? 'Removing…' : 'Remove add-on'}</button></div></div>}
        </div>)}
        {!activeApps.length && <p className="addon-empty">No active add-ons. Add a web app from New Session or restore one below.</p>}
        {removedApps.length > 0 && <details className="addon-removed"><summary>Removed add-ons ({removedApps.length})</summary>
          <p className="addon-hint">Restore adds the shortcut back with its saved settings.</p>
          {removedApps.map(app => <div className="addon-info addon-row" key={app.name} data-addon-name={app.name}>
            <PluginIcon icon={webAppIcon(app)} size={23}/><span><strong>{app.defaultTitle}</strong><small>Removed</small></span>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={`Restore ${app.defaultTitle}`} disabled={busy} onClick={() => {
              setError(''); try { usePluginStore.getState().setPluginRemoved(app.name, false); } catch { setError('Could not save this change. Please try again.'); }
            }}><RotateCcw size={14}/>Restore</button></div>)}
        </details>}
      </div>
      {error && <p className="addon-error" role="alert">{error}</p>}
    </div>
  </div>, ownerDocument.body);
}
