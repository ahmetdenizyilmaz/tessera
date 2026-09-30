import { X, Package, Move, RotateCw, ShoppingBag } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { OFFICE_CATALOG, officeItem } from '../../lib/officeCatalog';
import { OfficeItemIcon } from './OfficeItemIcon';

export function EditModeOverlay() {
  const s = useOfficeGameStore();
  const items = OFFICE_CATALOG.filter(i => i.furnitureType ? s.inventory[i.id] > 0 : i.category === 'floor' && s.purchasedItems.includes(i.id));
  const selected = officeItem(s.selectedItem ?? '');
  return <aside className="office-editor" aria-label="Decorate office">
    <div className="office-panel-heading"><div><span className="office-eyebrow">ARRANGE YOUR SPACE</span><h3>Decorate</h3></div><button aria-label="Finish decorating" onClick={() => s.setEditMode(false)}><X size={18} /></button></div>
    <div className="office-edit-tools"><button className={s.editAction === 'move' ? 'active' : ''} onClick={() => useOfficeGameStore.setState({ editAction: 'move', movingId: null, notice: null })}><Move size={15} />Move</button><button className={s.editAction === 'pack' ? 'active' : ''} onClick={() => useOfficeGameStore.setState({ editAction: 'pack', movingId: null, notice: null })}><Package size={15} />Store</button><button onClick={() => useOfficeGameStore.setState({ rotation: ((s.rotation + 1) % 4) as 0 | 1 | 2 | 3 })} aria-label="Rotate furniture"><RotateCw size={15} />{s.rotation * 90}°</button></div>
    <p className="office-edit-hint">{s.editAction === 'pack' ? 'Click furniture to return it to storage.' : s.editAction === 'move' ? s.movingId ? 'Click an empty tile for the new position.' : 'Click the furniture you want to move.' : selected ? `Placing ${selected.name}. Click an empty tile.` : 'Choose an item, then click a tile in the office.'}</p>
    <h4>In storage</h4><div className="office-inventory">{items.map(item => <button key={item.id} className={s.selectedItem === item.id && s.editAction === 'place' ? 'active' : ''} onClick={() => s.selectItem(item.id)}><OfficeItemIcon type={item.sprite} /><span>{item.name}</span><small>{item.furnitureType ? `×${s.inventory[item.id]}` : 'Unlimited tiles'}</small></button>)}</div>
    {!items.length && <p className="office-panel-intro">Your storage is empty. Buy something in the shop, or store furniture from the room.</p>}
    <button className="office-editor-shop" onClick={() => s.setShopOpen(true)}><ShoppingBag size={16} />Visit shop</button>
    <p className="office-edit-notice" role="status">{s.notice}</p>
  </aside>;
}
