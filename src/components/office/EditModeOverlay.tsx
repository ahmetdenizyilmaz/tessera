import type { RefObject } from 'react';
import { X, Package, Move, RotateCw, ShoppingBag, Mouse } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { OFFICE_CATALOG, officeItem, itemImage, itemForFurniture } from '../../lib/officeCatalog';

export function EditModeOverlay({storageRef,storageHovered=false}:{storageRef?:RefObject<HTMLButtonElement|null>;storageHovered?:boolean}) {
  const s = useOfficeGameStore();
  const items = OFFICE_CATALOG.filter(i => i.furnitureType ? s.inventory[i.id] > 0 : i.category === 'floor' && s.purchasedItems.includes(i.id));
  const moving=s.layout.furniture.find(f=>f.id===s.movingId);
  const selected=moving?.workstationFor ? officeItem(s.profiles[moving.workstationFor]?.pc ?? 'pc-0') : moving ? itemForFurniture(moving) : officeItem(s.selectedItem??'');
  if(selected && (moving || s.editAction==='place')) {
    const stored=s.inventory[selected.id]??0;
    const protectedDesk=!!moving?.workstationFor || !!moving?.id.startsWith('auto-desk-');
    return <>
      <aside className="office-placement-bar" aria-label="Place furniture">
        <img src={itemImage(selected,s.rotation)} alt=""/>
        <div><strong>{moving?'Moving':'Placing'} {selected.name}</strong><small>{moving?'Choose a new spot':selected.category==='floor'?'Reusable floor finish':stored>0?`${stored} in storage${s.repeatPurchase?` · then ${selected.price.toLocaleString()} coins each`:''}`:`${selected.price.toLocaleString()} coins per copy`}</small><span role="status">{s.notice || 'Click or drag to place'}</span></div>
        <button onClick={()=>useOfficeGameStore.setState({rotation:((s.rotation+1)%4) as 0|1|2|3})} aria-label="Rotate furniture"><RotateCw size={17}/><span>{s.rotation*90}°</span></button>
        <button onClick={()=>s.setEditMode(false)} aria-label="Finish decorating"><X size={18}/></button>
        <p><Mouse size={13}/> Wheel / R to rotate · Escape to cancel</p>
      </aside>
      <button ref={storageRef} data-office-storage-target className={`office-storage-drop${storageHovered?' is-over':''}`} disabled={protectedDesk} aria-label="Store held item" onClick={()=>s.storeHeldItem()}>
        <Package size={27}/><strong>{protectedDesk?'Assigned workstation':moving || stored>0?'Return to storage':'Finish placing'}</strong><span>{protectedDesk?'Move this desk to keep it available':storageHovered?'Release here':moving || stored>0?'Drag here or click to store':'Drag here or click to finish'}</span>
      </button>
    </>;
  }
  return <aside className="office-editor" aria-label="Decorate office">
    <div className="office-panel-heading"><div><span className="office-eyebrow">ARRANGE YOUR SPACE</span><h3>Decorate</h3></div><button aria-label="Finish decorating" onClick={() => s.setEditMode(false)}><X size={18} /></button></div>
    <div className="office-edit-tools"><button className={s.editAction === 'move' ? 'active' : ''} onClick={() => useOfficeGameStore.setState({ editAction: 'move', movingId: null, selectedItem:null, repeatPurchase:false, notice: null })}><Move size={15} />Move</button><button className={s.editAction === 'pack' ? 'active' : ''} onClick={() => useOfficeGameStore.setState({ editAction: 'pack', movingId: null, selectedItem:null, repeatPurchase:false, notice: null })}><Package size={15} />Store</button></div>
    <p className="office-edit-hint">{s.editAction === 'pack' ? 'Click furniture to return it to storage.' : s.editAction === 'move' ? s.movingId ? 'Click an empty tile for the new position.' : 'Click the furniture you want to move.' : selected ? `Placing ${selected.name}. Click an empty tile.` : 'Choose an item, then click a tile in the office.'}</p>
    <h4>In storage</h4><div className="office-inventory">{items.map(item => <button key={item.id} className={s.selectedItem === item.id && s.editAction === 'place' ? 'active' : ''} onClick={() => s.selectItem(item.id)}><img src={itemImage(item)} alt="" width="60" height="48"/><span>{item.name}</span><small>{item.furnitureType ? `×${s.inventory[item.id]}` : 'Unlimited tiles'}</small></button>)}</div>
    {!items.length && <p className="office-panel-intro">Your storage is empty. Buy something in the shop, or store furniture from the room.</p>}
    <button className="office-editor-shop" onClick={() => s.setShopOpen(true)}><ShoppingBag size={16} />Visit shop</button>
    <p className="office-edit-notice" role="status">{s.notice}</p>
  </aside>;
}
