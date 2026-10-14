import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Download, Github, RefreshCw } from 'lucide-react';
import { loadCatalogSource, saveCatalogSource, type AppCatalog, type CatalogEntry } from '../../lib/appCatalog';
import { usePluginStore } from '../../store/pluginStore';
import { PluginIcon } from '../icons/PluginIcon';
import { HtmlAppImport, type HtmlAppPreview } from './HtmlAppControls';

export function GitHubAppCatalog({ onOpen, onBusy }: { onOpen: (name:string)=>void; onBusy:(busy:boolean)=>void }) {
  const [source,setSource] = useState(loadCatalogSource);
  const [catalog,setCatalog] = useState<AppCatalog | null>(null);
  const [preview,setPreview] = useState<HtmlAppPreview | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [search,setSearch] = useState(''), [category,setCategory] = useState('All');
  const registry=usePluginStore(s=>s.registry), removed=usePluginStore(s=>s.removedPlugins);
  const working=(value:boolean)=>{setBusy(value);onBusy(value);};
  const refresh=async()=>{
    working(true);setError('');setCatalog(null);setCategory('All');
    try {
      const result=await invoke<AppCatalog>('html_catalog_list',{repositoryUrl:source.repositoryUrl.trim(),reference:source.reference.trim()||null});
      saveCatalogSource({...source,repositoryUrl:result.repository});setSource(s=>({...s,repositoryUrl:result.repository}));setCatalog(result);
    } catch(e) {setError(String(e));} finally {working(false);}
  };
  const download=async(entry:CatalogEntry)=>{
    if(!catalog)return;working(true);setError('');
    try {setPreview(await invoke<HtmlAppPreview>('html_catalog_preview',{ticket:catalog.ticket,id:entry.id}));}
    catch(e){setError(String(e));}finally{working(false);}
  };
  if(preview)return <HtmlAppImport initialPreview={preview} onCancel={()=>setPreview(null)} onDone={onOpen} onBusy={onBusy}/>;
  const matches=catalog?.apps.filter(app=>(category==='All'||app.category===category)&&`${app.name} ${app.description}`.toLowerCase().includes(search.toLowerCase()))??[];
  return <section className="app-catalog">
    <div className="app-library-intro"><Github size={26}/><div><h3>Community apps</h3><p>Connect a public GitHub repository to browse its app catalog.</p></div></div>
    <form className="catalog-source" onSubmit={e=>{e.preventDefault();void refresh();}}>
      <label>Repository URL<input type="url" aria-label="GitHub repository URL" placeholder="https://github.com/owner/tessera-apps" value={source.repositoryUrl} disabled={busy} onChange={e=>{setSource({...source,repositoryUrl:e.target.value});setCatalog(null);}} required/></label>
      <label>Branch or tag <small>(optional)</small><input aria-label="Catalog branch or tag" placeholder="Repository default" value={source.reference} disabled={busy} onChange={e=>{setSource({...source,reference:e.target.value});setCatalog(null);}}/></label>
      <button type="submit" className="btn btn-primary" disabled={busy||!source.repositoryUrl.trim()}><RefreshCw size={14}/>{busy?'Loading…':'Load catalog'}</button>
    </form>
    {!catalog && <p className="addon-hint">You can set the repository later. It needs a <code>tessera-apps.json</code> catalog at its root. Apps download only when you choose them; updates require another review.</p>}
    {catalog && <><div className="app-library-filter"><input aria-label="Search community apps" type="search" placeholder="Search community apps" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Community app category" value={category} onChange={e=>setCategory(e.target.value)}>{['All',...new Set(catalog.apps.map(app=>app.category))].map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="app-library-grid">{matches.map(entry=>{
        const installed=registry.get(`html-${entry.id}`), enabled=installed&&!removed.has(installed.name), same=installed?.version===entry.version;
        return <article className="app-card" key={entry.id}><PluginIcon icon={entry.icon} size={28}/><h3>{entry.name}</h3><span className="app-card-kind">{entry.category} · v{entry.version}</span><p>{entry.description}</p>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>enabled&&same?onOpen(installed.name):void download(entry)}><Download size={14}/>{enabled&&same?'Open':installed&&!same?'Review update':'Download and review'}</button></article>;
      })}</div>{!matches.length&&<p className="addon-empty">No apps match this selection.</p>}
      <p className="addon-hint">{catalog.apps.length} apps · Catalog revision {catalog.commit.slice(0,8)}. Downloading does not grant network or agent access.</p></>}
    {error&&<p className="addon-error" role="alert">{error}</p>}
  </section>;
}
