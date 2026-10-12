import { WEARABLE_SLOTS, type ShopItem, type WearableSlot } from '../types/office';

/** Restricted SVG subset used by both Pixi and store thumbnails. No external assets. */
export function validateOfficeItem(value: unknown): ShopItem {
  const i = value as ShopItem;
  if (!i || i.version !== 1 || !/^[a-z0-9_-]+$/.test(i.id) || !i.name || !Number.isFinite(i.price) || i.price < 0)
    throw new Error('Invalid office item identity or price');
  if (!['floor', 'furniture', 'decoration', 'accessory', 'pc', 'server'].includes(i.category)) throw new Error(`Invalid category: ${i.id}`);
  if (!i.footprint || !Number.isInteger(i.footprint.w) || !Number.isInteger(i.footprint.h) || i.footprint.w < 1 || i.footprint.h < 1 || i.footprint.w > 8 || i.footprint.h > 8) throw new Error(`Invalid footprint: ${i.id}`);
  if (i.slot && !WEARABLE_SLOTS.includes(i.slot)) throw new Error(`Invalid slot: ${i.id}`);
  if (!i.art || i.art.length !== 4 || !i.anchor) throw new Error(`Missing artwork: ${i.id}`);
  if (![i.anchor.x,i.anchor.y].every(Number.isFinite)) throw new Error(`Invalid anchor: ${i.id}`);
  if (i.category === 'pc' && (!Number.isFinite(i.pcMultiplier) || i.pcMultiplier! < 1 || i.pcMultiplier! > 5)) throw new Error(`Invalid computer multiplier: ${i.id}`);
  if (i.category === 'accessory' && (!i.slot || !i.attachment || ![i.attachment.x,i.attachment.y,i.attachment.scale].every(Number.isFinite) || i.attachment.scale <= 0)) throw new Error(`Invalid wearable attachment: ${i.id}`);
  if (i.color && !/^#[a-f0-9]{6}$/i.test(i.color)) throw new Error(`Invalid color: ${i.id}`);
  for (const seat of i.seats ?? []) if (![seat.x,seat.y,...seat.approach].every(Number.isFinite) || seat.x<0 || seat.y<0 || seat.x>i.footprint.w || seat.y>i.footprint.h) throw new Error(`Invalid seat: ${i.id}`);
  for (const svg of [...i.art, ...(i.foreground ?? [])]) {
    if (typeof svg !== 'string' || svg.length > 250000 || !svg.startsWith('<svg ') || /<!|<\?|&|\bon[a-z]+\s*=|href|url\s*\(|style\s*=|<\/?(?:script|foreignObject|image|use|animate|set|style|a)\b/i.test(svg)) throw new Error(`Unsafe SVG: ${i.id}`);
    const tags = [...svg.matchAll(/<\/?([\w:]+)/g)].map(m => m[1]);
    if (tags.some(t => !['svg', 'g', 'path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line'].includes(t))) throw new Error(`Unsupported SVG: ${i.id}`);
  }
  for (const [x,y] of i.collision ?? []) if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= i.footprint.w || y >= i.footprint.h) throw new Error(`Invalid collision: ${i.id}`);
  if (i.bonus && (!['worker','environment','provider'].includes(i.bonus.scope) || !Number.isFinite(i.bonus.amount) || i.bonus.amount < 0 || i.bonus.amount > 1)) throw new Error(`Invalid bonus: ${i.id}`);
  if (i.category === 'server' && !['claude','codex','antigravity','openrouter'].includes(i.bonus?.provider ?? '')) throw new Error(`Invalid server provider: ${i.id}`);
  return i;
}
const bundled = import.meta.glob('../content/office/*.json', { eager: true, import: 'default' });
export const OFFICE_CATALOG = Object.values(bundled).map(validateOfficeItem).sort((a,b) => a.price-b.price || a.name.localeCompare(b.name));
const registry = new Map(OFFICE_CATALOG.map(i => [i.id, i]));
if (registry.size !== OFFICE_CATALOG.length) throw new Error('Duplicate office item id');
export function officeItem(id: string) { return registry.get(id); }
export const SLOT_LABELS: Record<WearableSlot, string> = { head: 'Head', face: 'Face', neck: 'Neck', shirt: 'Shirt' };
export const OFFICE_SHOP_SECTIONS: Record<string,string> = {
  pc:'Computers',desk:'Desks',chair:'Chairs',couch:'Sofas',plant:'Plants',lamp:'Lighting',bookshelf:'Shelves',
  whiteboard:'Planning boards',task_board:'Task boards',filing_cabinet:'Cabinets',coffee_machine:'Coffee stations',
  water_cooler:'Water coolers',printer:'Printers',server_rack:'Archives',rug:'Rugs',poster:'Wall art',floor:'Floors',
  shirt:'Shirts',head:'Headwear',face:'Eyewear',neck:'Neckwear',
  'server-claude':'Claude servers','server-codex':'Codex servers','server-antigravity':'Antigravity servers','server-openrouter':'OpenRouter servers',
};
export function shopSection(item:ShopItem) {
  return item.category==='server'?`server-${item.bonus?.provider}`:item.slot??item.furnitureType??item.category;
}
export function wearableKey(wearables?: Partial<Record<WearableSlot, string>>): string {
  return WEARABLE_SLOTS.map(slot => wearables?.[slot] ?? '').join('|');
}
export function itemForFurniture(f: { itemId?: string; type: string }) {
  return officeItem(f.itemId ?? '') ?? OFFICE_CATALOG.find(i => i.furnitureType === f.type);
}
export const itemImage = (item: ShopItem, rotation = 0) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.art![rotation])}`;
export function bonusLabel(item: ShopItem) {
  if (item.pcMultiplier) return `×${item.pcMultiplier.toFixed(2)} worker income`;
  const b = item.bonus;
  return b ? `+${(b.amount*100).toFixed(1)}% ${b.scope === 'worker' ? 'equipped worker' : b.scope === 'provider' ? b.provider : 'environment'}` : 'Cosmetic';
}
