import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(()=>{const data=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)});vi.stubGlobal('window',{localStorage:globalThis.localStorage});});
import { useOfficeGameStore as office, migrateOffice } from '../store/officeGameStore';
import { OFFICE_CATALOG, OFFICE_SHOP_SECTIONS, shopSection, validateOfficeItem, officeItem } from './officeCatalog';
import { activityAfter, baseCoins, incomeMultiplier, spinFactor, usageRates, ZERO_USAGE } from './officeEconomy';
import { connectedFloor, ensureWorkstations, furnitureCells, interactionTile, placementError, seatsIn } from './officeSpace';
import { getDefaultLayout } from '../engine/defaultOffice';
import { OfficeWander } from '../engine/OfficeWander';
import { WorkerAnimator } from '../engine/WorkerAnimator';
import { findPath } from '../engine/PathFinding';
import type { ActivityRecord } from '../types/activity';
import type { OfficeLayout } from '../types/office';
const room=():OfficeLayout=>({width:8,height:8,floorTiles:{},wallTiles:{},rooms:[],furniture:[]});
const record=(overrides:Partial<ActivityRecord>={}):ActivityRecord=>({id:'response',kind:'turn',actor:{id:'a',name:'Worker',provider:'codex',model:'gpt-6-astra',device:null},sessionId:'thread',startedAt:100,updatedAt:200,status:'running',prompt:'Test work',response:'',usage:{...ZERO_USAGE,input:100000,output:10000},parentId:null,target:null,origin:'user',usageNote:null,...overrides});
beforeEach(()=>office.setState({layout:room(),workers:{},profiles:{},panelAliases:{},currency:0,totalEarned:0,completedTasks:0,inventory:{},purchasedItems:[],rewards:[],claimed:{},startedAt:50,ledger:{},companyBase:0,modelBase:{},permanent:1,location:'studio',expansions:0,spinoffs:0,lifetimeCoins:0,legacyEarned:0,prices:{},pendingRecords:[],editMode:false,movingId:null,selectedItem:null,editAction:'place',rotation:0,repeatPurchase:false}));

describe('usage economy',()=>{
  it('starts fresh once, backs up only office state and never clears panel persistence',()=>{
    const workspace = '{"panels":["active-chat","active-terminal"]}';
    localStorage.setItem('tessera-autosave', workspace);
    office.getState().addWorker('a',{gridX:0,gridY:0});
    office.setState({currency:5000,inventory:{headphones:3},purchasedItems:['headphones'],permanent:1.5,location:'seaside',expansions:2,lifetimeCoins:6000,companyBase:1000,spinoffs:3});
    office.getState().equip('a','headphones');
    const before=localStorage.getItem('tessera-office');
    office.getState().resetFresh('test-fresh-office');
    const state=office.getState();
    expect(state).toMatchObject({currency:0,totalEarned:0,companyBase:0,modelBase:{},permanent:1,location:'studio',expansions:0,spinoffs:0,lifetimeCoins:0,legacyEarned:0,inventory:{},profiles:{},purchasedItems:[],ledger:{},pendingRecords:[],lastResetId:'test-fresh-office'});
    expect(state.layout.furniture.filter(f=>f.workstationFor)).toHaveLength(1);
    expect(state.layout.furniture.every(f=>f.id.startsWith('starter-')||f.id.startsWith('auto-desk-'))).toBe(true);
    expect(localStorage.getItem('tessera-autosave')).toBe(workspace);
    expect(localStorage.getItem('tessera-office-before-reset')).toBe(before);
    state.settleUsage(record());expect(office.getState().currency).toBe(0);
    office.setState({currency:12});state.resetFresh('test-fresh-office');expect(office.getState().currency).toBe(12);
  });
  it('does not turn supplied workstations into paid environment bonuses when panels close',()=>{
    office.getState().ensureCapacity(['a']);
    const baseline=incomeMultiplier(office.getState(),'a','codex','test');
    office.getState().ensureCapacity([]);
    expect(incomeMultiplier(office.getState(),'a','codex','test')).toBe(baseline);
  });
  it('settles running tokens once, then only the delayed increment at the original multiplier',()=>{
    office.getState().settleUsage(record());
    expect(office.getState().currency).toBeCloseTo(6);
    office.setState({permanent:10});
    office.getState().settleUsage(record());
    office.getState().settleUsage(record({status:'completed',usage:{...ZERO_USAGE,input:200000,output:20000}}));
    expect(office.getState().currency).toBeCloseTo(12);
    expect(office.getState().completedTasks).toBe(1);
    office.getState().settleUsage(record({status:'completed',usage:{...ZERO_USAGE,input:200000,output:20000}}));
    expect(office.getState().currency).toBeCloseTo(12);
  });
  it('does not double pay after a provider counter decreases then recovers',()=>{
    office.getState().settleUsage(record());
    office.getState().settleUsage(record({usage:{...ZERO_USAGE,input:1}}));
    office.getState().settleUsage(record());
    expect(office.getState().currency).toBeCloseTo(6);
  });
  it('counts consumed tokens on failure but never fabricates missing usage or handoff income',()=>{
    office.getState().settleUsage(record({status:'failed'}));
    office.getState().settleUsage(record({id:'missing',status:'completed',usage:null}));
    office.getState().settleUsage(record({id:'handoff',kind:'handoff'}));
    office.getState().settleUsage(record({id:'old',startedAt:0}));
    expect(office.getState().currency).toBeCloseTo(6);
    expect(office.getState().ledger['codex:thread:missing'].usage).toEqual(ZERO_USAGE);
  });
  it('shares known Analytics rates and labels unknown rates as game estimates',()=>{
    const r={input:3,output:15,cacheRead:.3,cacheWrite:3.75};
    expect(usageRates('anthropic/claude-sonnet-4-20260101',{'claude-sonnet-4':r})).toEqual({rates:r,estimated:false});
    expect(usageRates('unknown-model',{}).estimated).toBe(true);
    expect(baseCoins({...ZERO_USAGE,input:1000000,cacheRead:1000000,output:1000000,reasoning:500000},r)).toBe(183);
  });
  it('resolves the effective model when a provider first reports usage',()=>{
    office.setState({prices:{'claude-sonnet-4':{input:3,output:15,cacheRead:.3,cacheWrite:3.75}}});
    const first=record({actor:{...record().actor,model:null},usage:null});
    office.getState().settleUsage(first);
    office.getState().settleUsage({...first,actor:{...first.actor,model:'claude-sonnet-4'},usage:{...ZERO_USAGE,input:1000000}});
    expect(office.getState().currency).toBe(30);
    expect(office.getState().ledger['codex:thread:response'].estimated).toBe(false);
  });
  it('keeps model experience separate and preserves settlement identity through panel restore',()=>{
    office.getState().addWorker('a',{gridX:0,gridY:0});
    office.getState().settleUsage(record());
    office.getState().remapPanels(new Map([['a','restored']]));
    office.getState().settleUsage(record({status:'completed',usage:{...ZERO_USAGE,input:200000,output:20000}}));
    expect(office.getState().profiles.restored.coins).toBeCloseTo(12);
    expect(Object.keys(office.getState().modelBase)).toEqual(['codex:gpt-6-astra']);
  });
  it('recovers the ledger from persistence without replay rewards',async()=>{
    office.getState().settleUsage(record());
    const saved=localStorage.getItem('tessera-office')!;
    office.setState({currency:0,ledger:{}});localStorage.setItem('tessera-office',saved);
    await office.persist.rehydrate();office.getState().settleUsage(record());
    expect(office.getState().currency).toBeCloseTo(6);
  });
  it('activity rises slowly, decays when offline, and stays between one and two',()=>{
    const p={coins:0,tasks:0,wearables:{},activity:1,activityAt:0,activityState:'thinking' as const};
    expect(activityAfter(p,3600000)).toBeCloseTo(1.05);
    expect(activityAfter({...p,activity:1.8},3600000,true)).toBeCloseTo(1.7);
    expect(activityAfter(p,1000*3600000)).toBe(2);
    expect(activityAfter(p,1000*3600000,true)).toBe(1);
  });
  it('simulates the same fixed purchase and spin-off scale for light and heavy work',()=>{
    expect(spinFactor(750)).toBe(1.2);expect(spinFactor(1750)).toBe(1.3);
    expect(spinFactor(10000)-spinFactor(9000)).toBeLessThan(spinFactor(1000)-spinFactor(0));
    for(const daily of [20,100,500]) expect(Math.ceil(300/daily)*daily).toBeGreaterThanOrEqual(300);
  });
  it('multiplies successive spin-offs and excludes old records and bonus income',()=>{
    expect(office.getState().spinoff()).toBe(false);
    office.setState({companyBase:750,totalEarned:99999,lifetimeCoins:99999,inventory:{headphones:1},currency:200});
    expect(office.getState().spinoff()).toBe(true);
    expect(office.getState().permanent).toBe(1.2);
    expect(office.getState().inventory).toEqual({});expect(office.getState().currency).toBe(0);
    office.getState().settleUsage(record());expect(office.getState().currency).toBe(0);
    office.setState({companyBase:1750});office.getState().spinoff();
    expect(office.getState().permanent).toBeCloseTo(1.56);expect(office.getState().lifetimeCoins).toBe(99999);
  });
});

describe('items, migration, and space',()=>{
  it('buys into placement, charges extra copies only on valid drops, and stops at the budget',()=>{
    const price=officeItem('shop-plant-small')!.price;
    office.setState({currency:price*3,shopOpen:true});
    expect(office.getState().buyAndPlace('shop-plant-small')).toBe(true);
    expect(office.getState().shopOpen).toBe(false);expect(office.getState().editMode).toBe(true);
    expect(office.getState().placeAt({gridX:1,gridY:1})).toBe(true);
    expect(office.getState().currency).toBe(price*2);
    expect(office.getState().placeAt({gridX:1,gridY:1})).toBe(false);
    expect(office.getState().currency).toBe(price*2);
    expect(office.getState().placeAt({gridX:3,gridY:1})).toBe(true);
    expect(office.getState().placeAt({gridX:5,gridY:1})).toBe(true);
    expect(office.getState().currency).toBe(0);expect(office.getState().layout.furniture).toHaveLength(3);
    expect(office.getState().editMode).toBe(false);expect(office.getState().selectedItem).toBeNull();
    expect(office.getState().placeAt({gridX:1,gridY:3})).toBe(false);
  });
  it('keeps a cancelled paid item, exhausts stored copies without buying, and safely stores a picked object',()=>{
    const price=officeItem('shop-couch')!.price;
    office.setState({currency:price*4});office.getState().buyAndPlace('shop-couch');office.getState().setEditMode(false);
    expect(office.getState().inventory['shop-couch']).toBe(1);
    office.getState().selectItem('shop-couch');office.getState().placeAt({gridX:2,gridY:2});
    expect(office.getState().currency).toBe(price*3);expect(office.getState().editMode).toBe(false);
    const f=office.getState().layout.furniture[0];office.getState().beginMove(f.id);
    expect(office.getState().storeHeldItem()).toBe(true);
    expect(office.getState().layout.furniture).toHaveLength(0);expect(office.getState().inventory['shop-couch']).toBe(1);
    expect(office.getState().movingId).toBeNull();expect(office.getState().editMode).toBe(false);
    expect(office.getState().storeHeldItem()).toBe(false);expect(office.getState().inventory['shop-couch']).toBe(1);
    office.getState().ensureCapacity(['a']);const desk=office.getState().layout.furniture.find(f=>f.workstationFor==='a')!;
    office.getState().beginMove(desk.id);expect(office.getState().storeHeldItem()).toBe(false);
    expect(office.getState().layout.furniture.some(f=>f.id===desk.id)).toBe(true);
  });
  it('stores an unused purchased item without manufacturing another repeat copy',()=>{
    const price=officeItem('shop-plant-small')!.price;
    office.setState({currency:price*3});office.getState().buyAndPlace('shop-plant-small');
    office.getState().storeHeldItem();expect(office.getState().inventory['shop-plant-small']).toBe(1);
    office.getState().buyAndPlace('shop-plant-small');
    office.getState().placeAt({gridX:1,gridY:1});office.getState().placeAt({gridX:3,gridY:1});
    expect(office.getState().repeatPurchase).toBe(true);office.getState().storeHeldItem();
    expect(office.getState().currency).toBe(price);expect(office.getState().inventory['shop-plant-small']).toBe(0);
  });
  it('gives every product a focused collection and keeps infrastructure above personal equipment',()=>{
    for(const item of OFFICE_CATALOG)expect(OFFICE_SHOP_SECTIONS[shopSection(item)]).toBeTruthy();
    expect(officeItem('server-codex-1')!.price).toBeGreaterThan(officeItem('headphones')!.price*20);
    expect(officeItem('server-codex-3')!.price).toBeGreaterThan(officeItem('pc-4')!.price);
  });
  it('ships standalone, four-view definitions and rejects executable SVG',()=>{
    expect(OFFICE_CATALOG.length).toBeGreaterThanOrEqual(40);
    expect(OFFICE_CATALOG.filter(i=>i.category==='pc')).toHaveLength(5);
    expect(OFFICE_CATALOG.filter(i=>i.category==='server')).toHaveLength(12);
    const item=officeItem('shop-couch')!;
    expect(new Set(item.art).size).toBe(4);
    expect(()=>validateOfficeItem({...item,art:['<svg onload="alert(1)"></svg>',...item.art!.slice(1)]})).toThrow();
    expect(()=>validateOfficeItem({...item,art:['<svg ><foreignObject/></svg>',...item.art!.slice(1)]})).toThrow();
  });
  it('keeps equipment individual, returning the old item on replacement',()=>{
    office.setState({currency:2000});
    office.getState().purchase('headphones');office.getState().equip('a','headphones');office.getState().equip('b','headphones');
    expect(office.getState().profiles.b).toBeUndefined();
    office.getState().unequip('a','head');office.getState().equip('b','headphones');
    expect(office.getState().profiles.b.wearables.head).toBe('headphones');
    office.getState().purchase('pc-1');office.getState().equipPC('a','pc-1');office.getState().equipPC('b','pc-1');
    expect(office.getState().profiles.b.pc).toBeUndefined();
    office.getState().equipPC('a','pc-0');expect(office.getState().inventory['pc-1']).toBe(1);
    office.getState().removeWorker('b');office.getState().removeWorker('b');
    expect(office.getState().inventory.headphones).toBe(1);
  });
  it('caps repeated environment families and uses the best matching provider server',()=>{
    const furniture=['shop-plant-small','plant-olive','server-codex-1','server-codex-3','server-claude-3'].map((itemId,n)=>({id:String(n),itemId,type:officeItem(itemId)!.furnitureType!,position:{gridX:n,gridY:0},rotation:0 as const}));
    office.setState({layout:{...room(),furniture}});
    expect(incomeMultiplier(office.getState(),'a','codex','x')).toBeCloseTo(1.018*1.30);
    expect(incomeMultiplier(office.getState(),'a','antigravity','x')).toBeCloseTo(1.018);
  });
  it('migrates old shared clothes and coins without awarding historical usage',()=>{
    const layout=getDefaultLayout();
    const old={layout,currency:159,totalEarned:5000,purchasedItems:['headphones'],profiles:{a:{coins:20,tasks:4,wearables:{head:'headphones'}},b:{coins:30,tasks:4,wearables:{head:'headphones'}}}};
    const next=migrateOffice(old,2);
    expect(next.currency).toBe(15);expect(next.layout).toBe(layout);expect(next.profiles.b.wearables.head).toBe('headphones');
    expect(next.companyBase).toBe(0);expect(next.legacyEarned).toBe(5000);expect(next.startedAt).toBeGreaterThan(100);
    expect(localStorage.getItem('tessera-office-before-tycoon-v3')).toContain('159');
  });
  it.each([0,1,6,30])('supplies %i reachable workstations without moving existing objects',count=>{
    const layout=getDefaultLayout(), before=JSON.stringify(layout.furniture);
    const next=ensureWorkstations(layout,Array.from({length:count},(_,i)=>`worker-${i}`));
    expect(next.furniture.filter(f=>f.workstationFor)).toHaveLength(count);
    expect(JSON.stringify(layout.furniture)).toBe(before);
    for(const f of next.furniture.filter(f=>f.workstationFor)) expect(findPath(next,{gridX:0,gridY:0},interactionTile(f)).length).toBeGreaterThan(0);
    expect(ensureWorkstations(next,Array.from({length:count},(_,i)=>`worker-${i}`))).toBe(next);
  });
  it('rotates footprints and seat approaches, permits rugs beneath furniture, rejects blocked routes',()=>{
    const couch={id:'c',type:'couch' as const,itemId:'shop-couch',position:{gridX:2,gridY:2},rotation:1 as const};
    expect(furnitureCells(couch)).toEqual([{gridX:2,gridY:2},{gridX:2,gridY:3}]);
    expect(seatsIn({...room(),furniture:[couch]})[0].approach).toEqual({gridX:1,gridY:2});
    expect(placementError({...room(),furniture:[couch]},{id:'r',type:'rug',itemId:'shop-rug-red',position:{gridX:2,gridY:2},rotation:0},{})).toBeNull();
    const wall={...room(),furniture:Array.from({length:8},(_,y)=>({id:String(y),type:'plant' as const,position:{gridX:3,gridY:y},rotation:0 as const}))};
    expect(connectedFloor(wall)).toBe(false);
  });
  it('idle agents reserve separate couch seats and actually arrive seated',()=>{
    const layout={...room(),furniture:[{id:'sofa',itemId:'shop-couch',type:'couch' as const,position:{gridX:3,gridY:3},rotation:0 as const}]};
    office.getState().addWorker('a',{gridX:0,gridY:0});office.getState().addWorker('b',{gridX:1,gridY:0});
    const workers=Object.fromEntries(Object.entries(office.getState().workers).map(([id,w])=>[id,{...w,activity:'idle' as const}]));
    const wander=new OfficeWander();wander.update(0,layout,workers,()=>0);
    const changes=wander.update(61000,layout,workers,()=>0);
    expect(changes.a.seat?.index).toBe(0);expect(changes.b.seat?.index).toBe(1);
    const animator=new WorkerAnimator();animator.assignPath('a',changes.a,layout);
    expect(animator.update(10,changes).get('a')?.seat?.furnitureId).toBe('sofa');
  });
});
