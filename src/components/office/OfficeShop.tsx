import { useState } from 'react';
import { X, Coins, RotateCw, Package, ArrowLeft, ChevronRight } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { OFFICE_CATALOG, OFFICE_SHOP_SECTIONS, shopSection, bonusLabel, itemImage } from '../../lib/officeCatalog';

export function OfficeShop() {
  const [category,setCategory]=useState<string|null>(null), [preview,setPreview]=useState<string|null>(null), [rotation,setRotation]=useState(0);
  const s=useOfficeGameStore();
  const selected=OFFICE_CATALOG.find(i=>i.id===preview);
  return <aside className="office-shop" aria-label="Office shop">
    <div className="office-panel-heading"><div><span className="office-eyebrow">THE STUDIO COLLECTION</span><h3>Make room for good work</h3></div><button aria-label="Close shop" onClick={()=>s.setShopOpen(false)}><X size={18}/></button></div>
    <p className="office-panel-intro">{category?'Buy furniture to place it immediately. Keep placing copies while you have coins.':'Find a collection for every part of your studio.'}</p>
    {category ? <div className="office-shop-breadcrumb"><button aria-label="Shop categories" onClick={()=>{setCategory(null);setPreview(null);}}><ArrowLeft size={15}/>Collections</button><ChevronRight size={13}/><strong>{OFFICE_SHOP_SECTIONS[category]}</strong></div> : <div className="office-shop-departments">{Object.entries(OFFICE_SHOP_SECTIONS).map(([id,name])=>{
      const items=OFFICE_CATALOG.filter(i=>i.id!=='pc-0' && shopSection(i)===id);if(!items.length)return null;
      return <button key={id} aria-label={name} onClick={()=>{setCategory(id);setPreview(null);}}><img src={itemImage(items.at(-1)!)} alt=""/><strong>{name}</strong><small>{items.length} {items.length===1?'item':'items'}</small><ChevronRight size={14}/></button>;
    })}</div>}
    {selected && <div className="office-item-preview"><img src={itemImage(selected,rotation)} alt=""/><div><strong>{selected.name}</strong><p>{selected.description}</p><span>{bonusLabel(selected)}</span>{selected.furnitureType && <small>{selected.footprint!.w} × {selected.footprint!.h} tiles</small>}<button aria-label="Rotate item preview" onClick={()=>setRotation((rotation+1)%4)}><RotateCw size={14}/>Rotate</button></div><button aria-label="Close item preview" onClick={()=>setPreview(null)}><X size={14}/></button></div>}
    {category && <div className="office-shop-items">{OFFICE_CATALOG.filter(i=>i.id!=='pc-0' && shopSection(i)===category).map(item=>{
      const owned=item.category==='floor' && s.purchasedItems.includes(item.id), count=s.inventory[item.id]??0;
      return <article className="office-shop-item" key={item.id} data-shop-item={item.id}>
        <button className="office-item-art" aria-label={`Preview ${item.name}`} onClick={()=>{setPreview(item.id);setRotation(0);}}><img src={itemImage(item)} alt="" loading="lazy"/></button>
        <div className="office-item-title"><strong>{item.name}</strong><span>{bonusLabel(item)}</span><small>{item.furnitureType?`${item.footprint!.w} × ${item.footprint!.h} tiles` : item.category==='accessory'?'One worker':item.category==='pc'?'One workstation':'Reusable finish'}{count>0?` · ${count} stored`:''}</small></div>
        <div className="office-item-actions"><button disabled={owned||s.currency<item.price} onClick={()=>s.buyAndPlace(item.id)} aria-label={`Buy ${item.name}`}><Coins size={13}/>{owned?'Owned':item.price.toLocaleString()}{!owned && item.furnitureType && <span> · Place</span>}</button>
        {(item.furnitureType && count>0 || owned) && <button onClick={()=>s.selectItem(item.id)} aria-label={`Place ${item.name}`}><Package size={13}/>Place</button>}</div>
      </article>;
    })}</div>}
    <div className="office-shop-foot" role="status">{s.notice??'Equip PCs and outfits from a worker’s details. Stored objects give no bonus.'}</div>
  </aside>;
}
