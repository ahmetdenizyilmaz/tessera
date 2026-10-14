// Real WebView2 panel games, using the isolated HTML validation profile.
import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const exe = fileURLToPath(new URL('../src-tauri/target/debug/examples/html_plugin_validation.exe', import.meta.url));
let child, browser, page, port = 10100 + Math.floor(Math.random()*100), stderr = '';
const errors = [];
const invoke = (command,args={}) => page.evaluate(({command,args}) => window.htmlTest.invoke(command,args), {command,args});
async function probe(id,expression) { const r=await invoke('validation_eval',{id,expression}); if(!r.ok)throw Error(r.error);return r.value; }
async function launch() {
  port++;
  child=spawn(exe,[],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
  child.stderr.on('data',d=>stderr+=d);console.log('Owned action games validation PID',child.pid);
  await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},{timeout:25000}).toBe(true);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await expect.poll(()=>{page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('html-plugin-fixture.html'));return !!page;},{timeout:20000}).toBe(true);
  page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.htmlTest);
}
async function finish() {
  if(page)await invoke('validation_exit').catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(child?.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);
  if(child?.exitCode===null)child.kill();child=null;browser=null;page=null;
}
async function ready(id) { await expect.poll(async()=>{try{return await probe(id,'!!window.panelGame');}catch{return false;}},{timeout:25000}).toBe(true); }
async function open(slug) {
  const id=await page.evaluate(name=>{window.htmlTest.creation.createPluginPanel(name);return window.htmlTest.layout.getState().activeTabId;},'html-tessera.game-'+slug);
  await ready(id);return id;
}
const licenses={menja:'GNU GENERAL PUBLIC LICENSE',onoff:'Permission is hereby granted','radius-raid':'Permission is hereby granted'};
try {
  await launch();
  for(const slug of Object.keys(licenses)) {
    const plugin='html-tessera.game-'+slug;
    await invoke('html_plugin_set_enabled',{plugin,enabled:true});
    await page.evaluate(name=>window.htmlTest.plugins.getState().setPluginRemoved(name,false),plugin);
  }
  await page.getByRole('button',{name:'Apps',exact:true}).click();
  await page.getByRole('button',{name:'App library…',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'App library',exact:true});await manager.getByLabel('App category').selectOption('Games');
  for(const name of ['Menja','ONOFF','Radius Raid'])await expect(manager.getByRole('button',{name:`Open ${name}`,exact:true})).toBeVisible();
  await expect(manager).toContainText('Slice flying 3D cubes');
  await manager.getByRole('button',{name:'Open Menja',exact:true}).click();
  const menja=await page.evaluate(()=>window.htmlTest.layout.getState().activeTabId);await ready(menja);
  await probe(menja,"(()=>{document.querySelector('.play-normal-btn').click();incrementScore(75);panelGame.pause();return true})()");
  expect(await probe(menja,'panelGame.best')).toBeGreaterThanOrEqual(75);
  const best=await probe(menja,'panelGame.best');

  const onoff=await open('onoff');
  // Complete the first level through the real collision/transition path.
  await probe(onoff,"(()=>{document.querySelector('#resume').click();game.scene.index=0;game.scene.guy.x=game.scene.goal.x;game.scene.guy.y=game.scene.goal.y+game.scene.goal.height-game.scene.guy.height;game.scene.tick(n=>Math.round(n/60));return true})()");
  await expect.poll(()=>probe(onoff,'panelGame.level'),{timeout:10000}).toBe(1);
  await probe(onoff,'panelGame.pause()');
  const another=await open('onoff');expect(await probe(another,'panelGame.level')).toBe(0);
  expect((await probe(onoff,'Tessera.ready')).instanceId).not.toBe((await probe(another,'Tessera.ready')).instanceId);

  const raid=await open('radius-raid');
  await expect.poll(()=>probe(raid,'!!$.hero')).toBe(true);
  expect(await probe(raid,'$.mute')).toBe(true);
  await probe(raid,"(()=>{document.querySelector('#play').click();$.enemies.push($.spawnEnemy(0));const i=$.enemies.length-1;$.enemies[i].receiveDamage(i,$.enemies[i].life);panelGame.pause();return true})()");
  expect(await probe(raid,'$.score')).toBeGreaterThan(0);
  const raidBest=await probe(raid,'$.storage.score');
  const bounds=await probe(raid,"(()=>{const b=document.querySelector('#cmg').getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:innerWidth,h:innerHeight}})()");
  expect(bounds.x).toBeGreaterThanOrEqual(-1);expect(bounds.right).toBeLessThanOrEqual(bounds.w+1);expect(bounds.bottom).toBeLessThanOrEqual(bounds.h+1);

  for(const [id,slug] of [[menja,'menja'],[onoff,'onoff'],[raid,'radius-raid']]) {
    expect((await probe(id,'Tessera.ready')).permissions).toEqual({network:[],panels:[],targets:[]});
    expect(await probe(id,"fetch('./LICENSE.txt').then(r=>r.text())")).toContain(licenses[slug]);
    expect((await probe(id,"fetch('./UPSTREAM.json').then(r=>r.json())")).commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await probe(id,"Tessera.panels.list().then(()=>false,e=>String(e))")).toMatch(/permission.*not enabled/);
    expect(await probe(id,"Tessera.net.fetch('https://example.com').then(()=>false,e=>String(e))")).toMatch(/not been granted/);
    await invoke('browser_panel_action',{id,action:'reload'});await ready(id);
  }
  expect(await probe(menja,'panelGame.best')).toBe(best);
  expect(await probe(onoff,'panelGame.level')).toBe(1);expect(await probe(onoff,'panelGame.paused')).toBe(true);
  await expect.poll(()=>probe(raid,'!!$.hero')).toBe(true);expect(await probe(raid,'$.storage.score')).toBe(raidBest);
  // Audio files must be accessible through the actual custom protocol as well.
  expect(await probe(raid,"fetch('./sounds/shoot-0.webm').then(r=>r.arrayBuffer()).then(b=>b.byteLength)")).toBeGreaterThan(1000);
  console.log('PASS native Games library, all three packages, local audio, licenses, denied optional permissions, independent ONOFF progress, reload');

  await page.evaluate(id=>window.htmlTest.windows.detachPanel(id),onoff);
  await expect.poll(async()=>(await invoke('validation_info',{id:onoff})).parent,{timeout:15000}).toMatch(/^workspace-/);
  expect(await probe(onoff,'panelGame.level')).toBe(1);expect(await probe(onoff,'panelGame.paused')).toBe(true);
  await page.evaluate(id=>window.htmlTest.windows.movePanelToWindow(id,null),onoff);
  await expect.poll(async()=>(await invoke('validation_info',{id:onoff})).parent).toBe('main');
  const saved=await page.evaluate(()=>window.htmlTest.serializeWorkspace());await finish();
  await launch();await page.evaluate(saved=>window.htmlTest.deserializeWorkspace(saved),saved);
  for(const id of [menja,onoff,another,raid])await ready(id);
  expect(await probe(menja,'panelGame.best')).toBe(best);expect(await probe(onoff,'panelGame.level')).toBe(1);expect(await probe(another,'panelGame.level')).toBe(0);
  expect(await probe(onoff,'panelGame.paused')).toBe(true);await expect.poll(()=>probe(raid,'!!$.hero')).toBe(true);expect(await probe(raid,'$.storage.score')).toBe(raidBest);expect(await probe(raid,'$.state')).toBe('menu');
  expect(errors).toEqual([]);
  console.log('PASS native detach/reattach and full restart: level progress and best scores retained; games await deliberate Play');
} catch(error) { console.error(stderr.slice(-2000));throw error; }
finally { await finish(); }
