import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { useOfficeGameStore } from '../../store/officeGameStore';
import type { ShopItem } from '../../types/office';

const SHOP_ITEMS: ShopItem[] = [
  // Furniture
  { id: 'shop-desk-oak', name: 'Oak Desk', category: 'furniture', price: 100, sprite: 'desk', furnitureType: 'desk' },
  { id: 'shop-desk-modern', name: 'Modern Desk', category: 'furniture', price: 200, sprite: 'desk', furnitureType: 'desk' },
  { id: 'shop-chair-ergo', name: 'Ergonomic Chair', category: 'furniture', price: 150, sprite: 'chair', furnitureType: 'chair' },
  { id: 'shop-bookshelf', name: 'Bookshelf', category: 'furniture', price: 120, sprite: 'bookshelf', furnitureType: 'bookshelf' },
  { id: 'shop-cabinet', name: 'Filing Cabinet', category: 'furniture', price: 80, sprite: 'filing_cabinet', furnitureType: 'filing_cabinet' },
  { id: 'shop-whiteboard', name: 'Whiteboard', category: 'furniture', price: 90, sprite: 'whiteboard', furnitureType: 'whiteboard' },
  { id: 'shop-couch', name: 'Leather Couch', category: 'furniture', price: 300, sprite: 'couch', furnitureType: 'couch' },
  { id: 'shop-server', name: 'Server Rack', category: 'furniture', price: 500, sprite: 'server_rack', furnitureType: 'server_rack' },

  // Decorations
  { id: 'shop-plant-small', name: 'Small Plant', category: 'decoration', price: 30, sprite: 'plant', furnitureType: 'plant' },
  { id: 'shop-plant-large', name: 'Large Plant', category: 'decoration', price: 60, sprite: 'plant', furnitureType: 'plant' },
  { id: 'shop-lamp-desk', name: 'Desk Lamp', category: 'decoration', price: 40, sprite: 'lamp', furnitureType: 'lamp' },
  { id: 'shop-poster-code', name: 'Code Poster', category: 'decoration', price: 25, sprite: 'poster', furnitureType: 'poster' },
  { id: 'shop-rug-red', name: 'Red Rug', category: 'decoration', price: 75, sprite: 'rug', furnitureType: 'rug' },
  { id: 'shop-water-cooler', name: 'Water Cooler', category: 'decoration', price: 60, sprite: 'water_cooler', furnitureType: 'water_cooler' },
  { id: 'shop-coffee', name: 'Coffee Machine', category: 'decoration', price: 200, sprite: 'coffee_machine', furnitureType: 'coffee_machine' },
  { id: 'shop-printer', name: 'Printer', category: 'decoration', price: 150, sprite: 'printer', furnitureType: 'printer' },

  // Floor tiles
  { id: 'shop-floor-wood', name: 'Wood Floor', category: 'floor', price: 5, sprite: 'wood' },
  { id: 'shop-floor-marble', name: 'Marble Floor', category: 'floor', price: 15, sprite: 'marble' },
  { id: 'shop-floor-carpet', name: 'Carpet', category: 'floor', price: 8, sprite: 'carpet' },

  // Wall styles
  { id: 'shop-wall-glass', name: 'Glass Partition', category: 'wall', price: 50, sprite: 'glass' },
  { id: 'shop-wall-brick', name: 'Brick Wall', category: 'wall', price: 30, sprite: 'brick' },
];

type ShopCategory = 'all' | 'floor' | 'wall' | 'furniture' | 'decoration';

export function OfficeShop() {
  const [category, setCategory] = useState<ShopCategory>('all');
  const currency = useOfficeGameStore(s => s.currency);
  const purchasedItems = useOfficeGameStore(s => s.purchasedItems);
  const purchase = useOfficeGameStore(s => s.purchase);
  const setShopOpen = useOfficeGameStore(s => s.setShopOpen);

  const filteredItems = category === 'all'
    ? SHOP_ITEMS
    : SHOP_ITEMS.filter(item => item.category === category);

  const handlePurchase = (item: ShopItem) => {
    if (currency >= item.price && !purchasedItems.includes(item.id)) {
      purchase(item.id, item.price);
    }
  };

  const categories: { key: ShopCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'furniture', label: 'Furniture' },
    { key: 'decoration', label: 'Decor' },
    { key: 'floor', label: 'Floors' },
    { key: 'wall', label: 'Walls' },
  ];

  return (
    <div className="office-shop">
      <div className="office-shop__header">
        <h3>Office Shop</h3>
        <button className="office-shop__close" onClick={() => setShopOpen(false)}>
          <X size={18} />
        </button>
      </div>

      <div className="office-shop__categories">
        {categories.map(cat => (
          <button
            key={cat.key}
            className={`office-shop__cat-btn ${category === cat.key ? 'office-shop__cat-btn--active' : ''}`}
            onClick={() => setCategory(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="office-shop__items">
        {filteredItems.map(item => {
          const owned = purchasedItems.includes(item.id);
          const canAfford = currency >= item.price;

          return (
            <div key={item.id} className={`office-shop__item ${owned ? 'office-shop__item--owned' : ''}`}>
              <div className="office-shop__item-preview">
                <div className="office-shop__item-sprite" data-type={item.sprite} />
              </div>
              <div className="office-shop__item-info">
                <span className="office-shop__item-name">{item.name}</span>
                <span className="office-shop__item-price">
                  {owned ? (
                    <><Check size={14} /> Owned</>
                  ) : (
                    <>{item.price} coins</>
                  )}
                </span>
              </div>
              {!owned && (
                <button
                  className="office-shop__buy-btn"
                  disabled={!canAfford}
                  onClick={() => handlePurchase(item)}
                >
                  Buy
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
