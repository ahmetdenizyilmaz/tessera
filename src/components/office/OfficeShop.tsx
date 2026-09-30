import { useState } from 'react';
import { X, Coins, Check, ArrowUpRight } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import { OFFICE_CATALOG } from '../../lib/officeCatalog';
import { OfficeItemIcon } from './OfficeItemIcon';

export function OfficeShop() {
  const [category, setCategory] = useState('all');
  const s = useOfficeGameStore();
  return <aside className="office-shop" aria-label="Office shop">
    <div className="office-panel-heading"><div><span className="office-eyebrow">MAKE IT YOURS</span><h3>Office shop</h3></div><button aria-label="Close shop" onClick={() => s.setShopOpen(false)}><X size={18} /></button></div>
    <p className="office-panel-intro">Furniture comes with one piece. Floors and accessories unlock for the whole team.</p>
    <div className="office-shop-categories">{[['all', 'All'], ['furniture', 'Furniture'], ['decoration', 'Decor'], ['floor', 'Floors'], ['accessory', 'Wearables']].map(([key, title]) => <button key={key} className={key === category ? 'active' : ''} onClick={() => setCategory(key)}>{title}</button>)}</div>
    <div className="office-shop-items">{OFFICE_CATALOG.filter(item => category === 'all' || item.category === category).map(item => {
      const owned = !item.furnitureType && s.purchasedItems.includes(item.id), count = s.inventory[item.id] ?? 0;
      return <div className="office-shop-item" key={item.id} data-shop-item={item.id}><div className={`office-item-art ${item.category}`}><OfficeItemIcon type={item.sprite} size={30} /></div><div className="office-item-title"><strong>{item.name}</strong><span>{owned ? 'Unlocked' : `${item.price} coins`}{count > 0 ? ` · ${count} in storage` : ''}</span></div>
        <div className="office-item-actions">{!owned ? <button disabled={s.currency < item.price} onClick={() => s.purchase(item.id)} aria-label={`Buy ${item.name}`}><Coins size={13} />{item.price}</button> : <span className="office-owned"><Check size={14} />Owned</span>}
        {(count > 0 || (owned && item.category === 'floor')) && <button className="office-place-button" onClick={() => s.selectItem(item.id)} aria-label={`Place ${item.name}`}>Place<ArrowUpRight size={13} /></button>}</div></div>;
    })}</div>
    <div className="office-shop-foot" role="status">{s.notice ?? '30 coins per completed turn + up to 20 for reported work categories.'}</div>
  </aside>;
}
