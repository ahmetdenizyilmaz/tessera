import { useRef, useState } from 'react';
import { ImagePlus, X, Plus } from 'lucide-react';
import { PluginIcon } from '../icons/PluginIcon';
import { usePluginStore } from '../../store/pluginStore';
import { WEB_APP_ICONS, webAppImage } from '../../lib/webApps';
import './web-app.css';

export function AddWebApp({onAdded,onCancel}:{onAdded:(name:string)=>void;onCancel:()=>void}) {
  const [name,setName]=useState(''),[url,setUrl]=useState(''),[icon,setIcon]=useState('Globe'),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const imageInput=useRef<HTMLInputElement>(null);
  return <form className="nsw-web-app" aria-label="Add web app" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onCancel();}}} onSubmit={e=>{
    e.preventDefault();setError('');
    try{const id=usePluginStore.getState().addWebApp({name,url,icon});onAdded(id);}catch(e){setError(e instanceof Error?e.message:String(e));}
  }}>
    <div className="nsw-web-app-heading"><PluginIcon icon={icon} size={26}/><div><strong>Add a web app</strong><p>Your own website panel, with sign-in kept between restarts.</p></div><button type="button" aria-label="Cancel web app" onClick={onCancel}><X size={17}/></button></div>
    <label>Name<input autoFocus maxLength={60} value={name} onChange={e=>setName(e.target.value)} placeholder="My music player" required/></label>
    <label>Web address<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://example.com" required inputMode="url" spellCheck={false}/></label>
    <fieldset><legend>Icon</legend><div className="nsw-web-app-icons">{WEB_APP_ICONS.map(choice=><button key={choice} type="button" className={icon===choice?'selected':''} aria-label={`${choice} icon`} aria-pressed={icon===choice} onClick={()=>setIcon(choice)}><PluginIcon icon={choice} size={21}/></button>)}<button type="button" className={icon.startsWith('data:')?'selected':''} aria-label="Upload icon image" onClick={()=>imageInput.current?.click()} disabled={loading}>{icon.startsWith('data:')?<PluginIcon icon={icon} size={21}/>:<ImagePlus size={21}/>}</button></div></fieldset>
    <input ref={imageInput} type="file" accept="image/*" hidden aria-label="Icon image" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setLoading(true);setError('');try{setIcon(await webAppImage(file));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}}}/>
    {error && <p role="alert" className="nsw-web-app-error">{error}</p>}
    <div className="nsw-web-app-footer"><small>Tabs, groups, detached windows, and click-to-focus work just like Lichess.</small><button type="submit" className="btn btn-primary" disabled={loading || !name.trim() || !url.trim()}><Plus size={15}/>Add and open</button></div>
  </form>;
}
