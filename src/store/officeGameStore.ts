import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { OfficeLayout, OfficeWorker, GridPosition, WorkerActivity, WorkerProfile, OfficeReward, WearableSlot, OfficeSettlement, OfficeRates, OfficeLocation } from '../types/office';
import { getDefaultLayout } from '../engine/defaultOffice';
import { officeItem, OFFICE_CATALOG } from '../lib/officeCatalog';
import { ensureWorkstations, expandOffice, furnitureCells, insideOffice, placementError } from '../lib/officeSpace';

import type { ActivityRecord } from '../types/activity';
import { activityAfter, baseCoins, incomeMultiplier, modelKey, OFFICE_BALANCE, OFFICE_LOCATIONS, spinFactor, usageDelta, usageRates, ZERO_USAGE } from '../lib/officeEconomy';

const emptyProfile = (): WorkerProfile => ({ coins: 0, tasks: 0, wearables: {} });
export interface OfficeGameState {
  companyBase: number;
  modelBase: Record<string,number>;
  permanent: number;
  location: OfficeLocation;
  expansions: number;
  spinoffs: number;
  lifetimeCoins: number;
  legacyEarned: number;
  ledger: Record<string, OfficeSettlement>;
  prices: Record<string, OfficeRates>;
  companyOpen: boolean;
  settleUsage: (record: ActivityRecord) => void;
  tickActivity: (now?: number, offline?: boolean) => void;
  ensureCapacity: (ids: string[]) => void;
  equipPC: (id: string, itemId: string) => void;
  expand: () => void;
  relocate: (location: OfficeLocation) => void;
  spinoff: () => boolean;
  beginMove: (id: string) => void;
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
  purchase: (id: string) => boolean;
  selectItem: (id: string) => void;
  placeAt: (position: GridPosition) => boolean;
  /** Put an owned wearable on (its slot comes from the catalog), or clear a slot with `unequip`. */
  equip: (panelId: string, itemId: string) => void;
  unequip: (panelId: string, slot: WearableSlot) => void;
  remapPanels: (ids: Map<string, string>) => void;
  setEditMode: (enabled: boolean) => void;
  setShopOpen: (enabled: boolean) => void;
}

export const useOfficeGameStore = create<OfficeGameState>()(persist((set, get) => ({
  companyBase: 0, modelBase: {}, permanent: 1, location: 'studio', expansions: 0, spinoffs: 0, lifetimeCoins: 0, legacyEarned: 0, ledger: {}, prices: {}, companyOpen: false,
  layout: getDefaultLayout(), workers: {}, profiles: {}, panelAliases: {}, currency: 0, totalEarned: 0, completedTasks: 0,
  inventory: {}, purchasedItems: [], rewards: [], claimed: {}, startedAt: Date.now(), pendingRecords: [], syncError: null,
  editMode: false, shopOpen: false, selectedItem: null, rotation: 0, editAction: 'place', movingId: null, notice: null,
  settleUsage: record => {
    const s = get();
    if (record.kind !== 'turn' || record.actor.device || record.startedAt < s.startedAt) return;
    const id = `${record.actor.provider}:${record.sessionId}:${record.id}`;
    const panelId = s.panelAliases[record.actor.id] ?? record.actor.id;
    const model = record.actor.model ?? 'unknown';
    let entry = s.ledger[id];
    if (!entry) {
      const pricing = usageRates(model, s.prices);
      entry = { usage: {...ZERO_USAGE}, multiplier: incomeMultiplier(s,panelId,record.actor.provider,model), ...pricing, panelId, modelKey: modelKey(record.actor.provider,model) };
    }
    // Some providers reveal the effective model only with their first response.
    if (entry.modelKey.endsWith(':unknown') && model !== 'unknown' && Object.values(entry.usage).every(v=>v===0)) {
      entry = {...entry,...usageRates(model,s.prices),modelKey:modelKey(record.actor.provider,model)};
    }
    const delta = record.usage ? usageDelta(record.usage,entry.usage) : {...ZERO_USAGE};
    const base = baseCoins(delta,entry.rates), coins = base*entry.multiplier;
    const completed = record.status === 'completed' && !entry.completed;
    const usage = Object.fromEntries(Object.keys(ZERO_USAGE).map(k => [k,entry.usage[k as keyof typeof ZERO_USAGE]+delta[k as keyof typeof ZERO_USAGE]])) as unknown as typeof ZERO_USAGE;
    if (s.ledger[id] && !base && !completed) return;
    const profile = s.profiles[panelId] ?? emptyProfile();
    set({ ledger: {...s.ledger,[id]:{...entry,usage,completed:entry.completed || completed}},
      currency:s.currency+coins,totalEarned:s.totalEarned+coins,lifetimeCoins:s.lifetimeCoins+coins,companyBase:s.companyBase+base,
      modelBase:{...s.modelBase,[entry.modelKey]:(s.modelBase[entry.modelKey]??0)+base},
      completedTasks:s.completedTasks+Number(completed),
      profiles:{...s.profiles,[panelId]:{...profile,coins:profile.coins+coins,tasks:profile.tasks+Number(completed)}},
      rewards:coins>0 ? [{id:`${id}:${record.updatedAt}`,panelId,name:record.actor.name,task:record.prompt.slice(0,180),coins,base,estimated:entry.estimated,at:record.updatedAt},...s.rewards].slice(0,30) : s.rewards });
  },
  tickActivity: (now = Date.now(), offline = false) => set(s => ({profiles:Object.fromEntries(Object.entries(s.profiles).map(([id,p]) => [id,{...p,activity:activityAfter(p,now,offline),activityAt:now,activityState:s.workers[id]?.activity ?? 'idle'}]))})),
  ensureCapacity: ids => set(s => { const layout=ensureWorkstations(s.layout,ids); return layout===s.layout ? s : {layout}; }),
  equipPC: (id,itemId) => {
    const s=get(), item=officeItem(itemId), p=s.profiles[id]??emptyProfile();
    if (!item?.pcMultiplier || p.pc===itemId || (itemId!=='pc-0' && !(s.inventory[itemId]>0))) return;
    const inventory={...s.inventory};
    if (itemId!=='pc-0') inventory[itemId]--;
    if (p.pc && p.pc!=='pc-0') inventory[p.pc]=(inventory[p.pc]??0)+1;
    set({inventory,profiles:{...s.profiles,[id]:{...p,pc:itemId}}});
  },
  expand: () => { const s=get(), cost=OFFICE_BALANCE.expansionPrice*2**s.expansions; if (s.currency<cost) return; set({currency:s.currency-cost,expansions:s.expansions+1,layout:expandOffice(s.layout),notice:'New studio space is ready.'}); },
  relocate: location => {const s=get(), place=OFFICE_LOCATIONS[location]; if (!place || location===s.location || s.currency<place.price) return; set({location,currency:s.currency-place.price,notice:`Moved to ${place.name}.`});},
  spinoff: () => {
    const s=get(); if (s.companyBase<250) return false;
    const at=Date.now();
    set({currency:0,totalEarned:0,completedTasks:0,companyBase:0,modelBase:{},permanent:s.permanent*spinFactor(s.companyBase),spinoffs:s.spinoffs+1,
      location:'studio',expansions:0,inventory:{},purchasedItems:[],profiles:{},workers:{},rewards:[],claimed:{},ledger:{},pendingRecords:[],startedAt:at,
      layout:ensureWorkstations(getDefaultLayout(),Object.keys(s.workers)),editMode:false,shopOpen:false,companyOpen:false,selectedItem:null,movingId:null,notice:'Your new company starts here.'});
    return true;
  },
  beginMove: id => {const f=get().layout.furniture.find(f=>f.id===id);if(f) set({editMode:true,shopOpen:false,companyOpen:false,selectedItem:null,editAction:'move',movingId:id,rotation:f.rotation,notice:'Click to place · R to rotate · Escape to cancel'});},
  addWorker: (id, p) => set(s => s.workers[id] ? s : ({ profiles: s.profiles[id] ? s.profiles : { ...s.profiles, [id]: { ...emptyProfile(), appearanceId: id, activity:1, activityAt:Date.now() } }, workers: { ...s.workers, [id]: {
    instanceId: id, position: { x: p.gridX, y: p.gridY }, targetPosition: p, activity: 'new', assignedDesk: p,
    direction: 0, isWalking: false, task: '', detail: '',
  } } })),
  removeWorker: id => set(s => {
    const workers={...s.workers};delete workers[id];
    const p=s.profiles[id],inventory={...s.inventory};
    for(const item of [...Object.values(p?.wearables??{}),p?.pc].filter((v):v is string=>!!v && v!=='pc-0')) inventory[item]=(inventory[item]??0)+1;
    return {workers,inventory,profiles:p?{...s.profiles,[id]:{...p,wearables:{},pc:'pc-0',activityState:'idle'}}:s.profiles};
  }),
  updateWorker: (id, activity, task, detail, target) => set(s => {
    const w = s.workers[id];
    if (!w) return s;
    if (w.activity === activity && w.task === task && w.detail === detail && w.targetPosition.gridX === target.gridX && w.targetPosition.gridY === target.gridY) return s;
    const p=s.profiles[id]??emptyProfile(), now=Date.now();
    return { profiles: w.activity===activity ? s.profiles : {...s.profiles,[id]:{...p,activity:activityAfter(p,now),activityAt:now,activityState:activity}}, workers: { ...s.workers, [id]: { ...w, activity, task, detail, targetPosition: target, seat: activity==='idle' ? w.seat : undefined } } };
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
  purchase: id => {
    const item = officeItem(id), s = get();
    if (!item || id==='pc-0' || s.currency < item.price || (item.category==='floor' && s.purchasedItems.includes(id))) return false;
    set({ currency: s.currency - item.price,
      inventory: item.category !== 'floor' ? { ...s.inventory, [id]: (s.inventory[id] ?? 0) + 1 } : s.inventory,
      purchasedItems: s.purchasedItems.includes(id) ? s.purchasedItems : [...s.purchasedItems, id],
      notice: `${item.name} ${item.category !== 'floor' ? 'added to inventory' : 'unlocked'}.` });
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
      if (f.workstationFor || f.id.startsWith('auto-desk-')) {set({notice:'Basic workstations stay available for your team. Move it instead.'});return false;}
      const item = officeItem(f.itemId ?? '') ?? OFFICE_CATALOG.find(i => i.furnitureType === f.type);
      if (!item) return false;
      set({ layout: { ...s.layout, furniture: s.layout.furniture.filter(x => x.id !== f.id) },
        inventory: { ...s.inventory, [item.id]: (s.inventory[item.id] ?? 0) + 1 }, workers:Object.fromEntries(Object.entries(s.workers).map(([id,w])=>[id,w.seat?.furnitureId===f.id?{...w,seat:undefined}:w])), notice: `${item.name} returned to inventory.` });
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
      workers:existing?Object.fromEntries(Object.entries(s.workers).map(([id,w])=>[id,w.seat?.furnitureId===existing.id?{...w,seat:undefined}:w])):s.workers,
      movingId: null, notice: existing ? 'Furniture moved.' : `${item?.name} placed.` });
    return true;
  },
  equip: (panelId,itemId) => {
    const s=get(), item=officeItem(itemId), profile=s.profiles[panelId]??emptyProfile();
    if (!item?.slot || !(s.inventory[itemId]>0) || profile.wearables[item.slot]===itemId) return;
    const old=profile.wearables[item.slot], inventory={...s.inventory,[itemId]:s.inventory[itemId]-1};
    if (old) inventory[old]=(inventory[old]??0)+1;
    set({inventory,profiles:{...s.profiles,[panelId]:{...profile,wearables:{...profile.wearables,[item.slot]:itemId}}}});
  },
  unequip: (panelId,slot) => {
    const s=get(), profile=s.profiles[panelId], old=profile?.wearables[slot]; if(!old) return;
    const wearables={...profile.wearables}; delete wearables[slot];
    set({inventory:{...s.inventory,[old]:(s.inventory[old]??0)+1},profiles:{...s.profiles,[panelId]:{...profile,wearables}}});
  },
  remapPanels: ids => set(s => {
    const profiles = { ...s.profiles }, panelAliases = { ...s.panelAliases };
    for (const [oldId, newId] of ids) {
      const source = panelAliases[oldId] ?? oldId;
      if (profiles[source]) { profiles[newId] = { ...profiles[source], appearanceId: profiles[source].appearanceId ?? source }; if (source !== newId) delete profiles[source]; }
      for (const key of Object.keys(panelAliases)) if (panelAliases[key] === source) panelAliases[key] = newId;
      panelAliases[oldId] = newId;
    }
    return { profiles, panelAliases, layout:{...s.layout,furniture:s.layout.furniture.map(f=>f.workstationFor ? {...f,workstationFor:ids.get(f.workstationFor)??f.workstationFor}:f)} };
  }),
  setEditMode: editMode => set({ editMode, companyOpen:false, shopOpen: false, movingId: null, notice: null }),
  setShopOpen: shopOpen => set({ shopOpen, companyOpen:false, editMode: false, movingId: null, notice: null }),
}), {
  name: 'tessera-office', version: 3,
  migrate: migrateOffice,
  onRehydrateStorage: () => state => { state?.tickActivity(Date.now(),true); },
  partialize: s => ({ companyBase:s.companyBase, modelBase:s.modelBase, permanent:s.permanent, location:s.location, expansions:s.expansions, spinoffs:s.spinoffs, lifetimeCoins:s.lifetimeCoins, legacyEarned:s.legacyEarned, ledger:s.ledger, layout: s.layout, currency: s.currency, totalEarned: s.totalEarned, completedTasks: s.completedTasks,
    inventory: s.inventory, purchasedItems: s.purchasedItems, profiles: s.profiles, panelAliases: s.panelAliases, rewards: s.rewards, claimed: s.claimed,
    startedAt: s.startedAt, pendingRecords: s.pendingRecords }),
}));

/** Exported for migration fixtures. Back up before the first destructive scale conversion. */
export function migrateOffice(saved: unknown, version: number): OfficeGameState {
  const old=saved as Partial<OfficeGameState>;
  if (version>=3) return old as OfficeGameState;
  localStorage.setItem('tessera-office-before-tycoon-v3',JSON.stringify({version,state:saved}));
  const inventory={...(old.inventory??{})}, profiles:Record<string,WorkerProfile>={};
  for (const [id,p] of Object.entries(old.profiles??{})) {
    const legacy=(p as WorkerProfile & {accessory?:string}).accessory;
    const wearables=p.wearables??(legacy?{head:legacy}:{});
    profiles[id]={...p,wearables,coins:0,tasks:0,activity:1,activityAt:Date.now(),activityState:'idle'};
  }
  for (const id of old.purchasedItems??[]) {
    const item=officeItem(id);
    if(item?.slot && !Object.values(profiles).some(p=>Object.values(p.wearables).includes(id))) inventory[id]=Math.max(1,inventory[id]??0);
  }
  return {...old,layout:old.layout?.rooms?.length?old.layout:getDefaultLayout(),currency:Math.floor(Math.max(0,old.currency??0)/10),
    profiles,inventory,companyBase:0,modelBase:{},permanent:1,location:'studio',expansions:0,spinoffs:0,lifetimeCoins:0,
    legacyEarned:old.totalEarned??0,totalEarned:0,completedTasks:0,ledger:{},claimed:{},rewards:[],pendingRecords:[],startedAt:Date.now()} as OfficeGameState;
}
