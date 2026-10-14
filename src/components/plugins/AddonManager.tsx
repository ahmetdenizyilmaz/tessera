import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, Trash2, X, FileCode2, ShieldCheck, Play, Github, Grid2X2 } from 'lucide-react';
import { usePluginStore } from '../../store/pluginStore';
import { webAppIcon } from '../../lib/webApps';
import { removePlugin } from '../../lib/pluginActions';
import { PluginIcon } from '../icons/PluginIcon';
import { usePanelWindow } from '../windows/PanelWindowContext';
import './addons.css';
import { HtmlAppImport, HtmlAppPermissions } from './HtmlAppControls';
import { setHtmlAppEnabled } from '../../lib/htmlPlugins';
import { createPluginPanel } from '../../lib/newSessionActions';
import { GitHubAppCatalog } from './GitHubAppCatalog';
import type { PluginManifest } from '../../types/plugin';

export function AddonManager({ onClose, initialName, initialImport = false, initialPermissions, onOpen }: { onClose: () => void; initialName?: string; initialImport?: boolean; initialPermissions?: string; onOpen?: (name:string)=>void }) {
  const ownerDocument = usePanelWindow().document ?? document;
  const registry = usePluginStore(s => s.registry);
  const instances = usePluginStore(s => s.instances);
  const removed = usePluginStore(s => s.removedPlugins);
  const [tab,setTab] = useState<'installed'|'github'>('installed');
  const [search,setSearch] = useState(''), [category,setCategory] = useState('All');
  const launch=(name:string)=>{(onOpen ?? createPluginPanel)(name);onClose();};
  const [selected, setSelected] = useState(initialName ?? '');
  const [importing, setImporting] = useState(initialImport);
  const [permissions, setPermissions] = useState(initialPermissions ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null), headingId = useId();
  useEffect(() => {
    const previous = ownerDocument.activeElement as HTMLElement | null;
    dialog.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [ownerDocument]);
  const kind=(app:PluginManifest)=>app.homeUrl?'Web players':app.icon==='Gamepad2'||app.icon==='Dice5'?'Games':'Tools';
  const activeApps = [...registry.values()].filter(app => !removed.has(app.name) && (category==='All'||kind(app)===category) && `${app.defaultTitle} ${app.description}`.toLowerCase().includes(search.toLowerCase()));
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
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')].filter(el => el.getClientRects().length);
          const first = controls[0], last = controls.at(-1), focused = ownerDocument.activeElement;
          if (event.shiftKey && (focused === first || focused === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && (focused === last || focused === dialog.current)) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><div><h2 id={headingId}>App library</h2><p>Small tools, quiet games, and your favorite websites</p></div>
        <button type="button" className="addon-close" aria-label="Close add-on manager" disabled={busy} onClick={onClose}><X size={18}/></button></header>
      {!importing && !permissions && <nav className="app-library-tabs" aria-label="Library sections"><button disabled={busy} aria-pressed={tab==='installed'} onClick={()=>setTab('installed')}><Grid2X2 size={15}/>Your apps</button><button disabled={busy} aria-pressed={tab==='github'} onClick={()=>setTab('github')}><Github size={15}/>Get apps</button></nav>}
      <div className="addon-list">
        {importing ? <HtmlAppImport onDone={launch} onCancel={() => setImporting(false)} onBusy={setBusy}/> : permissions && registry.has(permissions) ?
          <HtmlAppPermissions manifest={registry.get(permissions)!} onClose={() => setPermissions('')} onBusy={setBusy}/> : tab==='github' ? <GitHubAppCatalog onOpen={launch} onBusy={setBusy}/> : <>
        <button type="button" className="btn btn-secondary html-app-import-button" disabled={busy} onClick={() => setImporting(true)}><FileCode2 size={16}/>Import HTML app</button>
        <div className="app-library-filter"><input type="search" aria-label="Search installed apps" placeholder="Search your apps" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="App category" value={category} onChange={e=>setCategory(e.target.value)}>{['All','Tools','Games','Web players'].map(c=><option key={c}>{c}</option>)}</select></div>
        {activeApps.map(app => <div className="addon-row" key={app.name} data-addon-name={app.name}>
          <div className="addon-info"><PluginIcon icon={webAppIcon(app)} size={23}/><span><strong>{app.defaultTitle}</strong>
            <small>{app.htmlPlugin ? 'HTML app' : 'Web player'} · {openCount(app.name)} open</small></span>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={`Open ${app.defaultTitle}`} disabled={busy} onClick={()=>launch(app.name)}><Play size={14}/>Open</button>
            {app.htmlPlugin && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} aria-label={`Permissions for ${app.defaultTitle}`} onClick={() => setPermissions(app.name)}><ShieldCheck size={14}/></button>}
            <button type="button" className="btn btn-secondary btn-sm addon-remove" aria-label={`Remove ${app.defaultTitle}`} disabled={busy}
              onClick={() => { setError(''); setSelected(app.name); }}><Trash2 size={14}/>Remove</button></div>
          {selected === app.name && <div className="addon-confirm"><p>Remove <strong>{app.defaultTitle}</strong>?{openCount(app.name) > 0 && ` This will close ${openCount(app.name)} open ${openCount(app.name) === 1 ? 'panel' : 'panels'}.`}</p>
            <div><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setSelected('')}>Cancel</button>
              <button type="button" className="btn btn-sm addon-confirm-remove" aria-label={`Confirm removal of ${app.defaultTitle}`} disabled={busy} onClick={() => void remove(app.name)}>{busy ? 'Removing…' : 'Remove add-on'}</button></div></div>}
        </div>)}
        {!activeApps.length && <p className="addon-empty">No apps match this selection. Import an app or restore one below.</p>}
        <p className="addon-hint">Removing an app closes its panels. Saved notes, settings, and website logins are kept.</p>
        {removedApps.length > 0 && <details className="addon-removed"><summary>Removed add-ons ({removedApps.length})</summary>
          <p className="addon-hint">Restore adds the shortcut back with its saved settings.</p>
          {removedApps.map(app => <div className="addon-info addon-row" key={app.name} data-addon-name={app.name}>
            <PluginIcon icon={webAppIcon(app)} size={23}/><span><strong>{app.defaultTitle}</strong><small>Removed</small></span>
            <button type="button" className="btn btn-secondary btn-sm" aria-label={`Restore ${app.defaultTitle}`} disabled={busy} onClick={async () => {
              setError(''); setBusy(true); try { if (app.htmlPlugin) await setHtmlAppEnabled(app.name, true); usePluginStore.getState().setPluginRemoved(app.name, false); } catch { setError('Could not save this change. Please try again.'); } finally { setBusy(false); }
            }}><RotateCcw size={14}/>Restore</button></div>)}
        </details>}</>}
      </div>
      {error && <p className="addon-error" role="alert">{error}</p>}
    </div>
  </div>, ownerDocument.body);
}
