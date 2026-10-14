import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { FileCode2, FolderOpen, ArrowLeft, ShieldCheck } from 'lucide-react';
import type { HtmlPluginGrants, HtmlPluginPermissions, PanelPermission, PluginManifest } from '../../types/plugin';
import { usePluginStore } from '../../store/pluginStore';
import { closePanel } from '../../lib/panelCleanup';

const EMPTY_GRANTS: HtmlPluginGrants = { network: [], panels: [], targets: [] };
const labels: Record<PanelPermission, string> = {
  list: 'See selected panel names', read: 'Read selected conversations and replies',
  send: 'Send messages to selected agents', receive: 'Receive messages from selected agents',
};
interface Target { id: string; name: string; provider?: string }
export interface HtmlAppPreview {
  source?: string;
  ticket: string; pluginName: string; fileCount: number; bytes: number; replaces: string | null;
  manifest: { name: string; version: string; description: string; permissions: HtmlPluginPermissions };
}

export function HtmlPermissionFields({ requested, value, onChange, disabled }: {
  requested: HtmlPluginPermissions; value: HtmlPluginGrants; onChange: (value: HtmlPluginGrants) => void; disabled?: boolean;
}) {
  const [targets, setTargets] = useState<Target[]>([]), [error, setError] = useState('');
  useEffect(() => {
    if (!requested.panels.length) return;
    let disposed = false;
    void invoke<Target[]>('html_plugin_targets').then(list => { if (!disposed) setTargets(list); }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [requested.panels.length]);
  const toggle = <T extends string>(items: T[], item: T) => items.includes(item) ? items.filter(v => v !== item) : [...items, item];
  const knownIds = new Set(targets.map(t => t.id));
  return <div className="html-app-permissions">
    {!requested.network.length && !requested.panels.length && <p className="html-app-local"><ShieldCheck size={18}/>This app runs locally. No network or conversation access requested.</p>}
    {!!requested.network.length && <fieldset disabled={disabled}><legend>Allowed websites</legend><p>Only checked sites can be contacted through the app API.</p>
      {requested.network.map(origin => <label key={origin}><input type="checkbox" checked={value.network.includes(origin)} onChange={() => onChange({...value, network:toggle(value.network,origin)})}/><span>{origin}</span></label>)}
    </fieldset>}
    {!!requested.panels.length && <fieldset disabled={disabled}><legend>Optional panel access</legend><p>Leave these off for apps that do not need your agents.</p>
      {requested.panels.map(permission => <label key={permission}><input type="checkbox" checked={value.panels.includes(permission)} onChange={() => onChange({...value,panels:toggle(value.panels,permission)})}/><span>{labels[permission]}</span></label>)}
      {value.panels.includes('send') && <p className="html-app-notice">Sending a message can start agent work, run its tools, and use tokens.</p>}
      <p>Apply these permissions only to:</p>
      {targets.map(target => <label key={target.id}><input type="checkbox" checked={value.targets.includes(target.id)} disabled={!value.panels.length} onChange={() => onChange({...value,targets:toggle(value.targets,target.id)})}/><span>{target.name}<small>{target.provider}</small></span></label>)}
      {value.targets.filter(id => !knownIds.has(id)).map(id => <label key={id}><input type="checkbox" checked onChange={() => onChange({...value,targets:value.targets.filter(t=>t!==id)})}/><span>Closed panel · {id.slice(0,12)}</span></label>)}
      {!targets.length && <p>No agent panels are currently available. You can grant access later.</p>}
      {error && <p role="alert" className="addon-error">{error}</p>}
    </fieldset>}
    <p className="addon-hint">App storage is saved automatically. Permissions can be changed here at any time.</p>
  </div>;
}

export function HtmlAppImport({ onDone, onCancel, onBusy, initialPreview }: { onDone: (name:string) => void; onCancel: () => void; onBusy: (busy:boolean) => void; initialPreview?: HtmlAppPreview }) {
  const [preview,setPreview] = useState<HtmlAppPreview | null>(initialPreview ?? null), [grants,setGrants] = useState<HtmlPluginGrants>(EMPTY_GRANTS);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const setWorking = (value:boolean) => {setBusy(value);onBusy(value);};
  const choose = async (folder:boolean) => {
    setError('');setWorking(true);
    try {
      const path = await open({directory:folder,multiple:false,title:folder?'Choose HTML app folder':'Choose HTML app or ZIP',...(!folder?{filters:[{name:'HTML apps',extensions:['html','htm','zip']}]}:{})});
      if (typeof path !== 'string') return;
      const next = await invoke<HtmlAppPreview>('html_plugin_inspect',{path});
      setPreview(next);setGrants(EMPTY_GRANTS);
    } catch (e) { setError(String(e)); } finally { setWorking(false); }
  };
  const sample = async (name:string) => {
    setError('');setWorking(true);
    try {setPreview(await invoke<HtmlAppPreview>('html_plugin_sample',{sample:name}));setGrants(EMPTY_GRANTS);}
    catch(e){setError(String(e));}finally{setWorking(false);}
  };
  const install = async () => {
    if (!preview) return;
    setError('');setWorking(true);
    try {
      const existing = [...usePluginStore.getState().instances.values()].filter(i => i.pluginName === preview.pluginName);
      for (const instance of existing) await closePanel(instance.id, false);
      const manifest = await invoke<PluginManifest>('html_plugin_install',{ticket:preview.ticket,grants});
      usePluginStore.getState().registerHtmlApp(manifest);
      onDone(manifest.name);
    } catch (e) { setError(String(e)); } finally { setWorking(false); }
  };
  return <section className="html-app-import">
    <button type="button" className="html-app-back" disabled={busy} onClick={onCancel}><ArrowLeft size={15}/>Back to library</button>
    {!initialPreview && <><h3>Import a local HTML app</h3><p className="addon-hint">Games, calculators, notes, and other small apps. Choose a self-contained HTML file, or a folder/ZIP with manifest.json and its assets.</p>
    <div className="html-app-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void choose(false)}><FileCode2 size={16}/>Choose HTML / ZIP</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void choose(true)}><FolderOpen size={16}/>Choose folder</button></div>
    <p className="addon-hint">Or try an example:</p><div className="html-app-actions">{[['calculator','Calculator'],['notes','Notes'],['timer','Timer'],['clock','Clock'],['memory','Memory Break']].map(([name,label])=><button type="button" className="btn btn-secondary btn-sm" key={name} disabled={busy} onClick={()=>void sample(name)}>{label}</button>)}</div></>}
    {preview && <div className="html-app-preview"><h3>{preview.manifest.name}<small>v{preview.manifest.version}</small></h3><p>{preview.manifest.description}</p>{preview.source && <p className="addon-hint">Source: {preview.source}</p>}
      <p className="addon-hint">{preview.fileCount} files · {(preview.bytes / 1024).toFixed(0)} KB{preview.replaces ? ` · Replaces v${preview.replaces}` : ''}</p>
      {preview.replaces && <p className="html-app-notice">Updating closes this app’s open panels. Its saved data is kept. Review permissions for this version below.</p>}
      <HtmlPermissionFields requested={preview.manifest.permissions} value={grants} onChange={setGrants} disabled={busy}/>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void install()}>{busy ? 'Installing…' : preview.replaces ? 'Update and open' : 'Install and open'}</button>
    </div>}
    {error && <p className="addon-error" role="alert">{error}</p>}
  </section>;
}

export function HtmlAppPermissions({manifest,onClose,onBusy}:{manifest:PluginManifest;onClose:()=>void;onBusy:(busy:boolean)=>void}) {
  const [grants,setGrants] = useState<HtmlPluginGrants | null>(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(() => {
    let disposed = false;
    void invoke<HtmlPluginGrants>('html_plugin_permissions',{plugin:manifest.name,grants:null}).then(g=>{if(!disposed)setGrants(g);}).catch(e=>{if(!disposed)setError(String(e));});
    return()=>{disposed=true;};
  },[manifest.name]);
  return <section className="html-app-import"><button type="button" className="html-app-back" disabled={busy} onClick={onClose}><ArrowLeft size={15}/>Back to library</button>
    <h3>{manifest.defaultTitle} permissions</h3>
    {grants && <><HtmlPermissionFields requested={manifest.permissions ?? {network:[],panels:[]}} value={grants} onChange={setGrants} disabled={busy}/>
      <div className="html-app-actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={async()=>{
        setBusy(true);onBusy(true);setError('');
        try {await invoke('html_plugin_permissions',{plugin:manifest.name,grants});onClose();} catch(e){setError(String(e));} finally{setBusy(false);onBusy(false);}
      }}>{busy?'Saving…':'Save permissions'}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setGrants(EMPTY_GRANTS)}>Turn off all access</button></div></>}
    {!grants && !error && <p className="addon-hint">Loading permissions…</p>}
    {error && <p className="addon-error" role="alert">{error}</p>}
  </section>;
}
