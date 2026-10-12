// Synthetic sessions only; never connects to the user's live Tessera.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const out=new URL('../../tessera-office-validation/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1000}});
page.setDefaultTimeout(15000);
const errors=[];
page.on('pageerror',e=>{if(!e.message.includes('WebSocket closed without opened'))errors.push(e.message);});
await page.route('**/office-test*',r=>r.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tools/office-fixture.jsx"></script>`}));
async function tile(x,y) {
  return page.evaluate(({x,y})=>{
    const r=document.querySelector('.office-canvas').getBoundingClientRect(), l=window.office.getState().layout;
    const sx=(l.width+l.height)*32,sy=sx/2,z=Math.max(.25,Math.min(1.25,(r.width-90)/sx,(r.height-100)/sy));
    return {x:r.x+r.width/2-(l.width-l.height)*16*z+(x-y)*32*z,y:r.y+(r.height-sy*z)/2+18+(x+y+1)*16*z};
  },{x,y});
}
try {
  await page.goto(`${process.argv[2]??'http://localhost:1420'}/office-test`,{waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.locator('.office-canvas canvas')).toHaveCount(1,{timeout:60000});
  await expect(page.locator('[data-office-agent]')).toHaveCount(5);
  await expect.poll(()=>page.evaluate(()=>window.office.getState().currency)).toBeGreaterThan(4);
  expect(await page.evaluate(()=>window.office.getState().layout.furniture.filter(f=>f.workstationFor).length)).toBe(5);
  await page.screenshot({path:`${out}/tycoon-office.png`});
  console.log('PASS native usage adapter, five assigned workstations, live renderer');

  // Synthetic funds let the same run exercise every store interaction.
  await page.evaluate(()=>window.office.setState({currency:200000}));
  await page.getByRole('button',{name:'Shop',exact:true}).click();
  await page.getByRole('button',{name:'Computers',exact:true}).click();
  await expect(page.locator('[data-shop-item]')).toHaveCount(4);
  await page.getByRole('button',{name:'Preview Professional PC',exact:true}).click();
  const image=page.locator('.office-item-preview>img'),before=await image.getAttribute('src');
  await page.getByRole('button',{name:'Rotate item preview'}).click();
  expect(await image.getAttribute('src')).not.toBe(before);
  await page.getByRole('button',{name:'Buy Professional PC',exact:true}).click();
  await page.getByRole('button',{name:'Shop categories',exact:true}).click();
  await page.getByRole('button',{name:'Headwear',exact:true}).click();
  await page.getByRole('button',{name:'Buy Studio headphones',exact:true}).click();
  await page.getByRole('button',{name:'Shop categories',exact:true}).click();
  await page.getByRole('button',{name:'Shirts',exact:true}).click();
  await page.getByRole('button',{name:'Buy Sage tee',exact:true}).click();
  await page.screenshot({path:`${out}/tycoon-store.png`});
  await page.getByRole('button',{name:'Close shop',exact:true}).click();
  await page.locator('[data-office-agent="tester"]').click();
  await page.locator('.office-chat-profile>summary').click();
  await page.getByRole('combobox',{name:'Computer for Test engineer'}).selectOption('pc-2');
  await page.getByRole('combobox',{name:'Head wearable for Test engineer'}).selectOption('headphones');
  await page.getByRole('combobox',{name:'Shirt wearable for Test engineer'}).selectOption('shirt-sage');
  expect(await page.evaluate(()=>window.office.getState().inventory.headphones)).toBe(0);
  await expect(page.getByRole('complementary',{name:'Chat with Test engineer'})).toBeVisible();
  await page.screenshot({path:`${out}/tycoon-equipment.png`});
  await page.keyboard.press('Escape');
  console.log('PASS game store, four-view artwork, individual PC and outfit assignment, chat sidebar');

  await page.evaluate(()=>{const s=window.office.getState();s.purchase('shop-couch');s.selectItem('shop-couch');});
  await page.getByRole('button',{name:'Fit office',exact:true}).click();
  // Added empty expansion guarantees a reachable test placement bay.
  await page.evaluate(()=>window.office.getState().expand());
  await page.getByRole('button',{name:'Fit office',exact:true}).click();
  const y=await page.evaluate(()=>window.office.getState().layout.height-3);
  let p=await tile(3,y);await page.mouse.move(p.x,p.y);
  await page.keyboard.press('r');
  await page.screenshot({path:`${out}/tycoon-placement.png`});
  await page.mouse.click(p.x,p.y);
  const placed=await page.evaluate(()=>window.office.getState().layout.furniture.find(f=>f.itemId==='shop-couch'&&!f.id.startsWith('starter-')));
  expect(placed?.rotation).toBe(1);
  await page.keyboard.press('Escape');
  // Hit the physical object on the canvas; double-click must enter move mode.
  p=await tile(3,y+.5);await page.mouse.dblclick(p.x,p.y-15);
  await expect.poll(()=>page.evaluate(()=>window.office.getState().movingId)).toBe(placed.id);
  await page.keyboard.press('r');p=await tile(6,y);await page.mouse.move(p.x,p.y);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(id=>window.office.getState().layout.furniture.find(f=>f.id===id),placed.id)).toEqual(placed);
  console.log('PASS ghost placement, rotated footprint, canvas double-click pickup, Escape rollback');

  const existing=await page.evaluate(()=>window.office.getState().layout.furniture.map(f=>({id:f.id,position:f.position})));
  await page.evaluate(()=>{
    const base=window.instances.getState().instances.get('tester');
    window.instances.setState({instances:new Map(Array.from({length:30},(_,n)=>{const id=n<5?['architect','tester','research','designer','reviewer'][n]:`extra-${n}`;return [id,window.instances.getState().instances.get(id)??{...base,id,name:`Worker ${n}`}];}))});
  });
  await expect.poll(()=>page.evaluate(()=>window.office.getState().layout.furniture.filter(f=>f.workstationFor).length)).toBe(30);
  const after=await page.evaluate(()=>window.office.getState().layout.furniture);
  for(const f of existing) expect(after.find(a=>a.id===f.id)?.position).toEqual(f.position);
  console.log('PASS thirty-worker capacity expansion preserves previous furniture positions');

  await page.getByRole('button',{name:'Company',exact:true}).click();
  await page.locator('.office-location--seaside button').click();
  expect(await page.evaluate(()=>window.office.getState().location)).toBe('seaside');
  await page.screenshot({path:`${out}/tycoon-company.png`});
  await page.locator('.office-company-details summary').filter({hasText:'Advanced'}).click();
  await expect(page.getByRole('button',{name:'Reset company for spin-off'})).toBeDisabled();
  await page.evaluate(()=>window.office.setState({companyBase:750}));
  await page.getByRole('button',{name:'Reset company for spin-off'}).click();
  await expect(page.getByRole('alertdialog',{name:'Confirm company reset'})).toBeVisible();
  await page.getByRole('button',{name:'Confirm reset and spin off'}).click();
  expect(await page.evaluate(()=>window.office.getState().permanent)).toBe(1.2);
  expect(await page.evaluate(()=>window.office.getState().currency)).toBe(0);
  expect(await page.evaluate(()=>window.instances.getState().instances.size)).toBe(30);
  console.log('PASS relocation, previewed multiplicative spin-off, chat/panel identities retained');

  await page.setViewportSize({width:600,height:850});
  await page.getByRole('button',{name:'Shop',exact:true}).click();
  expect(await page.locator('.office-shop').evaluate(e=>e.getBoundingClientRect().right<=innerWidth)).toBe(true);
  await page.screenshot({path:`${out}/tycoon-narrow.png`});
  await page.getByRole('button',{name:'Close shop'}).click();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('.office-canvas canvas')).toHaveCount(1);
  expect(await page.evaluate(()=>window.office.getState().permanent)).toBe(1.2);
  expect(errors).toEqual([]);
  console.log('PASS narrow layout, persistence and renderer lifecycle without application errors');
} catch(e) {await page.screenshot({path:`${out}/tycoon-failure.png`});throw e;} finally {await browser.close();}
