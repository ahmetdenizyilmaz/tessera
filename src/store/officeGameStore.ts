import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { OfficeLayout, OfficeWorker, GridPosition, WorkerActivity, WorkerProfile, OfficeReward } from '../types/office';
import { getDefaultLayout } from '../engine/defaultOffice';
import { officeItem, OFFICE_CATALOG } from '../lib/officeCatalog';
import { furnitureCells, insideOffice, placementError } from '../lib/officeSpace';

const emptyProfile = (): WorkerProfile => ({ coins: 0, tasks: 0, accessory: '' });
interface OfficeGameState {
  layout: OfficeLayout;
  workers: Record<string, OfficeWorker>;
  profiles: Record<string, WorkerProfile>;
  panelAliases: Record<string, string>;
  currency: number;
  totalEarned: number;
  completedTasks: number;
  inventory: Record<string, number>;
  purchasedItems: string[];
  rewards: OfficeReward[];
  claimed: Record<string, true>;
  startedAt: number;
  pendingRecords: string[];
  syncError: string | null;
  editMode: boolean;
  shopOpen: boolean;
  selectedItem: string | null;
  rotation: 0 | 1 | 2 | 3;
  editAction: 'place' | 'pack' | 'move';
  movingId: string | null;
  notice: string | null;
  addWorker: (id: string, position: GridPosition) => void;
  removeWorker: (id: string) => void;
  updateWorker: (id: string, activity: WorkerActivity, task: string, detail: string, target: GridPosition) => void;
  settleWorkers: (positions: Map<string, { x: number; y: number; isWalking: boolean }>) => void;
  claimReward: (reward: OfficeReward) => boolean;
  purchase: (id: string) => boolean;
  selectItem: (id: string) => void;
  placeAt: (position: GridPosition) => boolean;
  equip: (panelId: string, accessory: string) => void;
  remapPanels: (ids: Map<string, string>) => void;
  setEditMode: (enabled: boolean) => void;
  setShopOpen: (enabled: boolean) => void;
}

export const useOfficeGameStore = create<OfficeGameState>()(persist((set, get) => ({
  layout: getDefaultLayout(), workers: {}, profiles: {}, panelAliases: {}, currency: 150, totalEarned: 0, completedTasks: 0,
  inventory: {}, purchasedItems: [], rewards: [], claimed: {}, startedAt: Date.now(), pendingRecords: [], syncError: null,
  editMode: false, shopOpen: false, selectedItem: null, rotation: 0, editAction: 'place', movingId: null, notice: null,
  addWorker: (id, p) => set(s => s.workers[id] ? s : ({ profiles: s.profiles[id] ? s.profiles : { ...s.profiles, [id]: { ...emptyProfile(), appearanceId: id } }, workers: { ...s.workers, [id]: {
    instanceId: id, position: { x: p.gridX, y: p.gridY }, targetPosition: p, activity: 'new', assignedDesk: p,
    direction: 0, isWalking: false, task: '', detail: '',
  } } })),
  removeWorker: id => set(s => { const workers = { ...s.workers }; delete workers[id]; return { workers }; }),
  updateWorker: (id, activity, task, detail, target) => set(s => {
    const w = s.workers[id];
    if (!w) return s;
    if (w.activity === activity && w.task === task && w.detail === detail && w.targetPosition.gridX === target.gridX && w.targetPosition.gridY === target.gridY) return s;
    return { workers: { ...s.workers, [id]: { ...w, activity, task, detail, targetPosition: target } } };
  }),
  settleWorkers: positions => set(s => {
    const workers = { ...s.workers };
    let changed = false;
    for (const [id, p] of positions) {
      const w = workers[id];
      if (!w || (w.position.x === p.x && w.position.y === p.y && w.isWalking === p.isWalking)) continue;
      workers[id] = { ...w, position: { x: p.x, y: p.y }, isWalking: p.isWalking }; changed = true;
    }
    return changed ? { workers } : s;
  }),
  claimReward: reward => {
    const s = get();
    if (s.claimed[reward.id] || !Number.isFinite(reward.coins) || reward.coins <= 0) return false;
    reward = { ...reward, panelId: s.panelAliases[reward.panelId] ?? reward.panelId };
    const profile = s.profiles[reward.panelId] ?? emptyProfile();
    set({ claimed: { ...s.claimed, [reward.id]: true }, currency: s.currency + reward.coins, totalEarned: s.totalEarned + reward.coins,
      completedTasks: s.completedTasks + 1, profiles: { ...s.profiles, [reward.panelId]: { ...profile, coins: profile.coins + reward.coins, tasks: profile.tasks + 1 } },
      rewards: [reward, ...s.rewards].slice(0, 30) });
    return true;
  },
  purchase: id => {
    const item = officeItem(id), s = get();
    if (!item || s.currency < item.price || (!item.furnitureType && s.purchasedItems.includes(id))) return false;
    set({ currency: s.currency - item.price,
      inventory: item.furnitureType ? { ...s.inventory, [id]: (s.inventory[id] ?? 0) + 1 } : s.inventory,
      purchasedItems: s.purchasedItems.includes(id) ? s.purchasedItems : [...s.purchasedItems, id],
      notice: `${item.name} ${item.furnitureType ? 'added to inventory' : 'unlocked'}.` });
    return true;
  },
  selectItem: id => {
    const item = officeItem(id), s = get();
    if (!item || (item.furnitureType ? !(s.inventory[id] > 0) : !s.purchasedItems.includes(id))) return;
    set({ selectedItem: id, editMode: true, shopOpen: false, editAction: 'place', movingId: null, notice: null });
  },
  placeAt: position => {
    const s = get();
    if (!s.editMode || !insideOffice(s.layout, position)) return false;
    if (s.editAction === 'pack' || (s.editAction === 'move' && !s.movingId)) {
      const f = [...s.layout.furniture].reverse().find(f => furnitureCells(f).some(p => p.gridX === position.gridX && p.gridY === position.gridY));
      if (!f) { set({ notice: 'Click a piece of furniture.' }); return false; }
      if (s.editAction === 'move') { set({ movingId: f.id, rotation: f.rotation, notice: 'Choose a new spot for this item.' }); return true; }
      const item = officeItem(f.itemId ?? '') ?? OFFICE_CATALOG.find(i => i.furnitureType === f.type);
      if (!item) return false;
      set({ layout: { ...s.layout, furniture: s.layout.furniture.filter(x => x.id !== f.id) },
        inventory: { ...s.inventory, [item.id]: (s.inventory[item.id] ?? 0) + 1 }, notice: `${item.name} returned to inventory.` });
      return true;
    }
    const existing = s.movingId ? s.layout.furniture.find(f => f.id === s.movingId) : undefined;
    const item = officeItem(s.selectedItem ?? '');
    if (!existing && (!item || (item.furnitureType ? !(s.inventory[item.id] > 0) : !s.purchasedItems.includes(item.id)))) return false;
    if (!existing && item?.category === 'floor') {
      set({ layout: { ...s.layout, floorTiles: { ...s.layout.floorTiles, [`${position.gridX},${position.gridY}`]: item.sprite } }, notice: null }); return true;
    }
    const type = existing?.type ?? item?.furnitureType;
    if (!type) return false;
    const furniture = { ...existing, id: existing?.id ?? crypto.randomUUID(), itemId: existing?.itemId ?? item?.id, type, position, rotation: s.rotation };
    const error = placementError(s.layout, furniture, s.workers);
    if (error) { set({ notice: error }); return false; }
    set({ layout: { ...s.layout, furniture: [...s.layout.furniture.filter(f => f.id !== furniture.id), furniture] },
      inventory: existing || !item ? s.inventory : { ...s.inventory, [item.id]: s.inventory[item.id] - 1 },
      movingId: null, notice: existing ? 'Furniture moved.' : `${item?.name} placed.` });
    return true;
  },
  equip: (panelId, accessory) => set(s => accessory && (!s.purchasedItems.includes(accessory) || officeItem(accessory)?.category !== 'accessory') ? s : ({
    profiles: { ...s.profiles, [panelId]: { ...(s.profiles[panelId] ?? emptyProfile()), accessory } },
  })),
  remapPanels: ids => set(s => {
    const profiles = { ...s.profiles }, panelAliases = { ...s.panelAliases };
    for (const [oldId, newId] of ids) {
      const source = panelAliases[oldId] ?? oldId;
      if (profiles[source]) { profiles[newId] = { ...profiles[source], appearanceId: profiles[source].appearanceId ?? source }; if (source !== newId) delete profiles[source]; }
      for (const key of Object.keys(panelAliases)) if (panelAliases[key] === source) panelAliases[key] = newId;
      panelAliases[oldId] = newId;
    }
    return { profiles, panelAliases };
  }),
  setEditMode: editMode => set({ editMode, shopOpen: false, movingId: null, notice: null }),
  setShopOpen: shopOpen => set({ shopOpen, editMode: false, movingId: null, notice: null }),
}), {
  name: 'tessera-office', version: 1,
  migrate: (saved: unknown) => {
    const old = saved as Partial<OfficeGameState>;
    const inventory: Record<string, number> = {};
    for (const id of old.purchasedItems ?? []) if (officeItem(id)?.furnitureType) inventory[id] = (inventory[id] ?? 0) + 1;
    return { ...old, layout: old.layout?.rooms.length ? old.layout : getDefaultLayout(), currency: Math.max(0, old.currency ?? 0) + 150, inventory,
      startedAt: Date.now(), pendingRecords: [] } as OfficeGameState;
  },
  partialize: s => ({ layout: s.layout, currency: s.currency, totalEarned: s.totalEarned, completedTasks: s.completedTasks,
    inventory: s.inventory, purchasedItems: s.purchasedItems, profiles: s.profiles, panelAliases: s.panelAliases, rewards: s.rewards, claimed: s.claimed,
    startedAt: s.startedAt, pendingRecords: s.pendingRecords }),
}));
