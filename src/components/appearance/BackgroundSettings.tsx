import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Globe, ImagePlus, Palette, RotateCcw, Settings2, X } from 'lucide-react';
import { useAppearanceStore } from '../../store/appearanceStore';
import { backgroundForeground, backgroundStyle, DEFAULT_BACKGROUND, importBackgroundImage, type PanelBackground } from '../../lib/panelBackground';
import { useBackgroundImage } from './PanelAppearance';
import { usePanelWindow } from '../windows/PanelWindowContext';
import './appearance.css';

const COLORS = ['#11151d','#18212c','#202b28','#272139','#35302a','#0d2534','#f0eee7','#ffffff'];
const FITS = [{ value:'cover',label:'Fill',hint:'Fill the panel; crop the edges.' },{value:'contain',label:'Fit',hint:'Show the whole image.'},{value:'stretch',label:'Stretch',hint:'Stretch to the panel edges.'},{value:'center',label:'Center',hint:'Keep the image’s saved size.'},{value:'tile',label:'Tile',hint:'Repeat the image.'}] as const;

export function BackgroundEditor({ value, onChange, disabled = false }: { value: PanelBackground; onChange: (value: PanelBackground) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const colorId = useId();
  const image = useBackgroundImage(value); const controlsDisabled = busy || disabled;
  const update = (patch: Partial<PanelBackground>) => onChange({ ...value, ...patch });
  return <div className="background-editor">
    <div className="background-preview" data-background-preview style={{ ...backgroundStyle(value,image?.image), color:value.mode==='theme'?'var(--text-primary)':backgroundForeground(value) }}>
      <span className="background-preview-label">Live preview</span><span className="background-preview-prompt">› Your workspace, your style</span><span className="background-preview-muted">Keep your work in focus.</span>
    </div>
    <fieldset disabled={controlsDisabled} className="background-fields"><legend className="sr-only">Background options</legend>
      <div className="background-modes" role="group" aria-label="Background type">{(['theme','color','image'] as const).map(mode=><button type="button" key={mode} aria-pressed={value.mode===mode} onClick={()=>update({mode})}>{mode==='theme'?'Theme default':mode==='color'?'Solid color':'Image'}</button>)}</div>
      {value.mode !== 'theme' && <div className="background-color"><label htmlFor={colorId}>{value.mode==='image'?'Base color':'Background color'}</label><div className="background-swatches">{COLORS.map(color=><button type="button" key={color} style={{background:color}} aria-label={`Use ${color}`} aria-pressed={value.color===color} onClick={()=>update({color})}>{value.color===color&&<Check size={14} color={backgroundForeground({...value,mode:'color',color})}/>}</button>)}<label className="background-custom-color" title="Choose a custom color"><Palette size={15}/><input id={colorId} type="color" aria-label="Custom background color" value={value.color} onChange={e=>update({color:e.target.value})}/></label></div></div>}
      {value.mode==='image' && <>
        <div className="background-image-row"><button type="button" className="btn btn-secondary" onClick={()=>input.current?.click()}><ImagePlus size={16}/>{busy?'Saving image…':value.imageId?'Change image':'Choose image'}</button><span title={value.imageName}>{value.imageName ?? 'PNG, JPEG, WebP · up to 20 MB'}</span></div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden aria-label="Choose background image" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);setError('');try{const image=await importBackgroundImage(file);onChange({...value,...image,mode:'image'});}catch(error){setError(String(error instanceof Error?error.message:error));}finally{setBusy(false);}}}/>
        <div className="background-fit" role="group" aria-label="Image fit">{FITS.map(fit=><button type="button" key={fit.value} title={fit.hint} aria-pressed={value.fit===fit.value} onClick={()=>update({fit:fit.value})}>{fit.label}</button>)}</div>
        <label className="background-dim">Dim image<span>{value.dim}%</span><input type="range" min="0" max="85" step="5" value={value.dim} onChange={e=>update({dim:Number(e.target.value)})}/></label>
        <p className="background-help">Images are copied into Tessera’s local storage. Moving the original file won’t affect your background.</p>
      </>}
    </fieldset>
    {(error || image?.error) && <p className="background-error" role="alert">{error || image?.error}</p>}
  </div>;
}

export function BackgroundSettings({ panelId, web = false }: { panelId?: string; web?: boolean }) {
  const [scope,setScope] = useState<'panel'|'global'>(panelId?'panel':'global');
  const global = useAppearanceStore(s=>s.global), own = useAppearanceStore(s=>panelId?s.panels[panelId]:undefined);
  const isPanel = scope==='panel' && !!panelId, inherited = isPanel && !own, value = isPanel ? own ?? global : global;
  const update = (next:PanelBackground) => isPanel ? useAppearanceStore.getState().setPanel(panelId,next) : useAppearanceStore.getState().setGlobal(next);
  return <section className="background-settings">
    {panelId && <div className="background-scope" role="group" aria-label="Settings scope"><button type="button" aria-pressed={isPanel} onClick={()=>setScope('panel')}>This panel</button><button type="button" aria-pressed={!isPanel} onClick={()=>setScope('global')}><Globe size={14}/>All panels</button></div>}
    <p className="background-help">{isPanel?'Keep a personal background for this panel, or follow your global settings.':'Default background for panels that use global settings. Panels with their own background keep it.'}</p>
    {isPanel && <label className="background-inherit"><input type="checkbox" checked={inherited} onChange={e=>useAppearanceStore.getState().setPanel(panelId,e.target.checked?null:{...global})}/>Use global background<span>{inherited?'Following global settings':'Custom for this panel'}</span></label>}
    <BackgroundEditor value={value} onChange={update} disabled={inherited}/>
    {web && <p className="background-help">Websites keep their own page design. This background appears on the panel’s focus card. Local HTML apps also receive the background behind their content.</p>}
    <button type="button" className="background-reset" disabled={inherited} onClick={()=>update({...DEFAULT_BACKGROUND})}><RotateCcw size={14}/>Restore theme background</button>
    <p className="background-help">Changes are saved automatically.</p>
  </section>;
}

export function PanelBackgroundDialog({ panelId, onClose, web = false }: { panelId: string; onClose: () => void; web?: boolean }) {
  const ownerDocument = usePanelWindow().document ?? document, ref = useRef<HTMLDivElement>(null), id = useId();
  useEffect(()=>{const previous=ownerDocument.activeElement as HTMLElement|null;ref.current?.focus();return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[ownerDocument]);
  return createPortal(<div className="dialog-overlay" data-browser-overlay onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget)onClose();}}><div ref={ref} className="background-dialog" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose();}if(e.key==='Tab'){const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden])')].filter(el=>el.getClientRects().length && !el.closest('fieldset:disabled'));const first=items[0],last=items.at(-1);if(e.shiftKey&&(ownerDocument.activeElement===first||ownerDocument.activeElement===ref.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(ownerDocument.activeElement===last||ownerDocument.activeElement===ref.current)){e.preventDefault();first?.focus();}}}}>
    <header><div><span className="background-kicker">Appearance</span><h2 id={id}>Panel background</h2></div><button type="button" className="toolbar-btn" aria-label="Close background settings" onClick={onClose}><X size={19}/></button></header><div className="background-dialog-body"><BackgroundSettings panelId={panelId} web={web}/></div><footer><button type="button" className="btn btn-primary" onClick={onClose}>Done</button></footer>
  </div></div>,ownerDocument.body);
}
export function PanelAppearanceButton({ panelId }: { panelId: string }) {
  const [open,setOpen]=useState(false);
  return <><button type="button" className="toolbar-btn" title="Panel appearance" aria-label="Panel appearance" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setOpen(true);}}><Settings2 size={14}/></button>{open&&<PanelBackgroundDialog panelId={panelId} onClose={()=>setOpen(false)}/>}</>;
}
