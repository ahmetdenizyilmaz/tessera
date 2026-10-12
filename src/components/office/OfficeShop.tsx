import { useState } from 'react';
import { X, Coins, RotateCw, Package } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { OFFICE_CATALOG, bonusLabel, itemImage } from '../../lib/officeCatalog';

export function OfficeShop() {
  const [category,setCategory]=useState('all'), [preview,setPreview]=useState<string|null>(null), [rotation,setRotation]=useState(0);
  const s=useOfficeGameStore();
  const selected=OFFICE_CATALOG.find(i=>i.id===preview);
  return <aside className="office-shop" aria-label="Office shop">
    <div className="office-panel-heading"><div><span className="office-eyebrow">THE STUDIO COLLECTION</span><h3>Make room for good work</h3></div><button aria-label="Close shop" onClick={()=>s.setShopOpen(false)}><X size={18}/></button></div>
    <p className="office-panel-intro">Furniture and equipment are individual objects. Bonuses apply when placed or equipped.</p>
    <div className="office-shop-categories">{[['all','All'],['pc','Computers'],['server','Servers'],['furniture','Furniture'],['decoration','Decor'],['accessory','Outfits'],['floor','Floors']].map(([id,name])=><button key={id} className={category===id?'active':''} onClick={()=>setCategory(id)}>{name}</button>)}</div>
    {selected && <div className="office-item-preview"><img src={itemImage(selected,rotation)} alt=""/><div><strong>{selected.name}</strong><p>{selected.description}</p><span>{bonusLabel(selected)}</span>{selected.furnitureType && <small>{selected.footprint!.w} × {selected.footprint!.h} tiles</small>}<button aria-label="Rotate item preview" onClick={()=>setRotation((rotation+1)%4)}><RotateCw size={14}/>Rotate</button></div><button aria-label="Close item preview" onClick={()=>setPreview(null)}><X size={14}/></button></div>}
    <div className="office-shop-items">{OFFICE_CATALOG.filter(i=>i.id!=='pc-0' && (category==='all'||i.category===category)).map(item=>{
      const owned=item.category==='floor' && s.purchasedItems.includes(item.id), count=s.inventory[item.id]??0;
      return <article className="office-shop-item" key={item.id} data-shop-item={item.id}>
        <button className="office-item-art" aria-label={`Preview ${item.name}`} onClick={()=>{setPreview(item.id);setRotation(0);}}><img src={itemImage(item)} alt="" loading="lazy"/></button>
        <div className="office-item-title"><strong>{item.name}</strong><span>{bonusLabel(item)}</span><small>{item.furnitureType?`${item.footprint!.w} × ${item.footprint!.h} tiles` : item.category==='accessory'?'One worker':item.category==='pc'?'One workstation':'Reusable finish'}{count>0?` · ${count} stored`:''}</small></div>
        <div className="office-item-actions"><button disabled={owned||s.currency<item.price} onClick={()=>s.purchase(item.id)} aria-label={`Buy ${item.name}`}><Coins size={13}/>{owned?'Owned':item.price.toLocaleString()}</button>
        {(item.furnitureType && count>0 || owned) && <button onClick={()=>s.selectItem(item.id)} aria-label={`Place ${item.name}`}><Package size={13}/>Place</button>}</div>
      </article>;
    })}</div>
    <div className="office-shop-foot" role="status">{s.notice??'Equip PCs and outfits from a worker’s details. Stored objects give no bonus.'}</div>
  </aside>;
}
