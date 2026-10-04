import { WEARABLE_SLOTS, type ShopItem, type WearableSlot } from '../types/office';

export const OFFICE_CATALOG: ShopItem[] = [
  { id: 'shop-desk-oak', name: 'Oak workstation', category: 'furniture', price: 80, sprite: 'desk', furnitureType: 'desk' },
  { id: 'shop-chair-ergo', name: 'Ergonomic chair', category: 'furniture', price: 40, sprite: 'chair', furnitureType: 'chair' },
  { id: 'shop-bookshelf', name: 'Research library', category: 'furniture', price: 90, sprite: 'bookshelf', furnitureType: 'bookshelf' },
  { id: 'shop-whiteboard', name: 'Planning board', category: 'furniture', price: 75, sprite: 'whiteboard', furnitureType: 'whiteboard' },
  { id: 'shop-couch', name: 'Lounge sofa', category: 'furniture', price: 120, sprite: 'couch', furnitureType: 'couch' },
  { id: 'shop-server', name: 'Build server', category: 'furniture', price: 180, sprite: 'server_rack', furnitureType: 'server_rack' },
  { id: 'shop-cabinet', name: 'Filing cabinet', category: 'furniture', price: 60, sprite: 'filing_cabinet', furnitureType: 'filing_cabinet' },
  { id: 'shop-tasks', name: 'Task board', category: 'furniture', price: 75, sprite: 'task_board', furnitureType: 'task_board' },
  { id: 'shop-plant-small', name: 'Desk-side plant', category: 'decoration', price: 30, sprite: 'plant', furnitureType: 'plant' },
  { id: 'shop-lamp-desk', name: 'Warm floor lamp', category: 'decoration', price: 40, sprite: 'lamp', furnitureType: 'lamp' },
  { id: 'shop-poster-code', name: 'Code poster', category: 'decoration', price: 25, sprite: 'poster', furnitureType: 'poster' },
  { id: 'shop-rug-red', name: 'Terracotta rug', category: 'decoration', price: 50, sprite: 'rug', furnitureType: 'rug' },
  { id: 'shop-water-cooler', name: 'Water cooler', category: 'decoration', price: 60, sprite: 'water_cooler', furnitureType: 'water_cooler' },
  { id: 'shop-coffee', name: 'Espresso machine', category: 'decoration', price: 100, sprite: 'coffee_machine', furnitureType: 'coffee_machine' },
  { id: 'shop-printer', name: 'Office printer', category: 'decoration', price: 70, sprite: 'printer', furnitureType: 'printer' },
  { id: 'shop-floor-wood', name: 'Oak flooring', category: 'floor', price: 100, sprite: 'wood' },
  { id: 'shop-floor-marble', name: 'Stone flooring', category: 'floor', price: 150, sprite: 'marble' },
  { id: 'shop-floor-carpet', name: 'Blue carpet', category: 'floor', price: 80, sprite: 'carpet' },
  { id: 'headphones', name: 'Studio headphones', category: 'accessory', price: 80, sprite: 'headphones', slot: 'head' },
  { id: 'cap', name: 'Builder cap', category: 'accessory', price: 60, sprite: 'cap', slot: 'head' },
  { id: 'beanie', name: 'Cozy beanie', category: 'accessory', price: 50, sprite: 'beanie', slot: 'head' },
  { id: 'beret', name: 'Artist beret', category: 'accessory', price: 70, sprite: 'beret', slot: 'head' },
  { id: 'visor', name: 'Sun visor', category: 'accessory', price: 55, sprite: 'visor', slot: 'head' },
  { id: 'party_hat', name: 'Party hat', category: 'accessory', price: 45, sprite: 'party_hat', slot: 'head' },
  { id: 'crown', name: 'Tiny crown', category: 'accessory', price: 250, sprite: 'crown', slot: 'head' },
  { id: 'halo', name: 'Halo', category: 'accessory', price: 300, sprite: 'halo', slot: 'head' },
  { id: 'glasses', name: 'Reading glasses', category: 'accessory', price: 60, sprite: 'glasses', slot: 'face' },
  { id: 'sunglasses', name: 'Sunglasses', category: 'accessory', price: 75, sprite: 'sunglasses', slot: 'face' },
  { id: 'monocle', name: 'Monocle', category: 'accessory', price: 120, sprite: 'monocle', slot: 'face' },
  { id: 'tie', name: 'Red tie', category: 'accessory', price: 40, sprite: 'tie', slot: 'neck' },
  { id: 'bowtie', name: 'Bow tie', category: 'accessory', price: 45, sprite: 'bowtie', slot: 'neck' },
  { id: 'scarf', name: 'Autumn scarf', category: 'accessory', price: 65, sprite: 'scarf', slot: 'neck' },
  { id: 'lanyard', name: 'Staff lanyard', category: 'accessory', price: 30, sprite: 'lanyard', slot: 'neck' },
];
export function officeItem(id: string) { return OFFICE_CATALOG.find(item => item.id === id); }
export const SLOT_LABELS: Record<WearableSlot, string> = { head: 'Head', face: 'Face', neck: 'Neck' };
/** The wearables a character shows, as one string so renderers can cache on it. */
export function wearableKey(wearables?: Partial<Record<WearableSlot, string>>): string {
  return WEARABLE_SLOTS.map(slot => wearables?.[slot] ?? '').join('|');
}
