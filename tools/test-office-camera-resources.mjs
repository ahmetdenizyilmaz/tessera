// Real Pixi camera and Office UI; synthetic agents and mocked OS file opening.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1000}});
page.setDefaultNavigationTimeout(90000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const artifacts='../tessera-office-validation';await mkdir(artifacts,{recursive:true});
const camera=()=>page.evaluate(()=>({...window.officeEngine.camera.current,moving:window.officeEngine.camera.moving}));
const settled=()=>expect.poll(async()=>(await camera()).moving).toBe(false);
const samples=()=>page.evaluate(()=>new Promise(resolve=>{
  const values=[];const frame=()=>{values.push(window.officeEngine.camera.current.zoom);if(values.length<32)requestAnimationFrame(frame);else resolve(values);};requestAnimationFrame(frame);
}));
try {
  await page.goto(`${process.argv[2]??'http://127.0.0.1:1420'}/tools/office-fixture.html`);
  await expect(page.locator('[data-office-agent]')).toHaveCount(5);
  await expect.poll(()=>page.evaluate(()=>Object.values(window.office.getState().workers).every(w=>w.position.x===w.targetPosition.gridX&&w.position.y===w.targetPosition.gridY)),{timeout:20000}).toBe(true);
  await settled();const before=await camera();
  const hit=await page.evaluate(()=>{
    const e=window.officeEngine,r=document.querySelector('.office-canvas').getBoundingClientRect();
    const p=e.workerGraphics.get('architect').body.toGlobal({x:0,y:-24});return{x:r.x+p.x,y:r.y+p.y};
  });
  await page.mouse.click(hit.x,hit.y);
  await expect(page.getByRole('complementary',{name:'Chat with Backend architect'})).toBeVisible();
  const zoomIn=await samples();await settled();
  expect((await camera()).zoom).toBeGreaterThan(before.zoom);
  expect(new Set(zoomIn.map(z=>z.toFixed(4))).size).toBeGreaterThan(3);
  await page.screenshot({path:`${artifacts}/office-agent-focus.png`});
  await page.getByRole('button',{name:'Close agent chat'}).click();
  const zoomOut=await samples();await settled();
  expect(new Set(zoomOut.map(z=>z.toFixed(4))).size).toBeGreaterThan(3);
  expect((await camera()).zoom).toBeCloseTo(before.zoom);
  console.log('PASS real character click smoothly zooms in; chat dismissal smoothly restores overview');

  await page.locator('[data-office-agent="architect"]').click();await settled();
  // Switching while open preserves the original overview, including a resize.
  await page.evaluate(()=>window.officeEngine.onWorkerClickHandler('tester'));await settled();
  await expect(page.getByRole('complementary',{name:'Chat with Test engineer'})).toBeVisible();
  await page.setViewportSize({width:1200,height:850});await settled();
  expect((await camera()).zoom).toBeGreaterThan(1.25);
  await page.getByRole('button',{name:'Close agent chat'}).click();await settled();
  expect((await camera()).zoom).toBeLessThan(1.25);
  await page.setViewportSize({width:1500,height:1000});await settled();
  const rect=await page.locator('.office-canvas').boundingBox();
  await page.mouse.move(rect.x+60,rect.y+60);await page.mouse.down();await page.mouse.move(rect.x+120,rect.y+90,{steps:5});await page.mouse.up();
  const panned=await camera();
  await page.locator('[data-office-agent="architect"]').click();await settled();
  await page.getByRole('button',{name:'Close agent chat'}).click();await settled();
  expect((await camera()).x).toBeCloseTo(panned.x);expect((await camera()).y).toBeCloseTo(panned.y);
  console.log('PASS switching agents and resizing maintain focus; a manually panned overview is restored');

  await page.locator('[data-office-agent="architect"]').click();
  await expect(page.getByRole('dialog',{name:'Files and links'})).toHaveCount(0);
  await expect(page.locator('.office-resource-list')).toHaveCount(0);
  await page.getByRole('button',{name:'Open agent working folder'}).click();
  expect(await page.evaluate(()=>window.officeCalls.filter(c=>c.command==='open_path_smart').at(-1).args)).toEqual({path:'C:\\fixture',cwd:null});
  await page.getByRole('button',{name:'Conversation resources'}).click();
  const menu=page.getByRole('dialog',{name:'Files and links'});
  await expect(menu.getByRole('button',{name:/plan\.md/})).toBeVisible();
  await expect(menu).not.toContainText('missing_dir');
  const grid=await menu.locator('ul').evaluate(el=>({display:getComputedStyle(el).display,columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,overflow:el.scrollWidth>el.clientWidth}));
  expect(grid).toEqual({display:'grid',columns:2,overflow:false});
  await page.screenshot({path:`${artifacts}/office-resources-grid.png`});
  await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(page.locator('.office-chat')).toBeVisible();
  await expect(page.getByRole('button',{name:'Conversation resources'})).toBeFocused();
  await page.getByRole('button',{name:'Conversation resources'}).click();
  await menu.getByRole('button',{name:/plan\.md/}).click();await expect(menu).toHaveCount(0);
  expect(await page.evaluate(()=>window.officeCalls.filter(c=>c.command==='open_path_smart').at(-1).args)).toEqual({path:'C:\\fixture\\notes\\plan.md',cwd:'C:\\fixture'});
  await page.getByRole('button',{name:'Conversation resources'}).click();
  await page.getByRole('textbox',{name:'Message Backend architect'}).click();await expect(menu).toHaveCount(0);
  await page.setViewportSize({width:600,height:850});
  await page.getByRole('button',{name:'Conversation resources'}).click();
  await expect(menu.getByRole('button',{name:/retry\.ts/})).toBeVisible();
  expect(await menu.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
  await page.screenshot({path:`${artifacts}/office-resources-narrow.png`});
  console.log('PASS hidden resource grid, validated local files, working-folder shortcut, narrow layout, Escape and outside dismissal');

  const reset=await page.evaluate(()=>{
    const before={instances:JSON.stringify([...window.instances.getState().instances]),chats:JSON.stringify([...window.chat.getState().sessions]),codex:JSON.stringify(window.codex.getState().sessions)};
    window.office.setState({currency:5000,inventory:{headphones:2},purchasedItems:['headphones'],permanent:1.4,location:'seaside'});
    window.office.getState().resetFresh('ui-reset');
    const after={instances:JSON.stringify([...window.instances.getState().instances]),chats:JSON.stringify([...window.chat.getState().sessions]),codex:JSON.stringify(window.codex.getState().sessions)};
    return {before,after,currency:window.office.getState().currency,inventory:window.office.getState().inventory,permanent:window.office.getState().permanent,location:window.office.getState().location};
  });
  expect(reset.before).toEqual(reset.after);expect(reset).toMatchObject({currency:0,inventory:{},permanent:1,location:'studio'});
  await page.getByRole('button',{name:'Close resources'}).click();await page.getByRole('button',{name:'Close agent chat'}).click();
  await expect(page.locator('[data-office-agent]')).toHaveCount(5);await settled();
  await page.screenshot({path:`${artifacts}/office-fresh-start.png`});
  expect(errors).toEqual([]);
  console.log('PASS fresh Office reset preserves all panel instances and Claude/Codex conversations');
} finally {await browser.close();}
