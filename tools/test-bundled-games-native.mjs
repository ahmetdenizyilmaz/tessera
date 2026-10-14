// Real sandboxed WebView2 game packages, isolated from the user's Tessera profile.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const exe=fileURLToPath(new URL('../src-tauri/target/debug/examples/html_plugin_validation.exe',import.meta.url));
let child,browser,page,port=9850+Math.floor(Math.random()*100),stderr='';
const errors=[];
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.htmlTest.invoke(command,args),{command,args});
async function probe(id,expression){const r=await invoke('validation_eval',{id,expression});if(!r.ok)throw Error(r.error);return r.value;}
async function launch(){
 port++;child=spawn(exe,[],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});child.stderr.on('data',d=>stderr+=d);console.log('Owned games validation PID',child.pid);
 await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},{timeout:25000}).toBe(true);
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 await expect.poll(()=>{page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('html-plugin-fixture.html'));return !!page;},{timeout:20000}).toBe(true);
 page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.htmlTest);
}
async function finish(){if(page)await invoke('validation_exit').catch(()=>{});if(browser)await browser.close().catch(()=>{});if(child?.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);if(child?.exitCode===null)child.kill();child=null;browser=null;page=null;}
async function ready(id,slug){await expect.poll(async()=>{try{return await probe(id,slug==='2048'?'!!window.game':'!!window.panelGame');}catch{return false;}},{timeout:25000}).toBe(true);}
async function open(slug){const id=await page.evaluate(name=>{window.htmlTest.creation.createPluginPanel(name);return window.htmlTest.layout.getState().activeTabId;},'html-tessera.game-'+slug);await ready(id,slug);return id;}
const state2048='game.serialize()';
const stateTetris='JSON.parse(JSON.stringify({blocks,score,rows,current,next}))';
const stateBreakout='({level:game.level,score:game.score.score,lives:game.score.lives,hits:game.court.bricks.map(b=>b.hit),x:game.ball.x,y:game.ball.y,paddle:game.paddle.x})';
try{
 await launch();
 for(const slug of ['2048','tetris','breakout']){const plugin='html-tessera.game-'+slug;await invoke('html_plugin_set_enabled',{plugin,enabled:true});await page.evaluate(name=>window.htmlTest.plugins.getState().setPluginRemoved(name,false),plugin);}
 await page.getByRole('button',{name:'Apps',exact:true}).click();await page.getByRole('button',{name:'App library…',exact:true}).click();
 const manager=page.getByRole('dialog',{name:'App library',exact:true});await manager.getByLabel('App category').selectOption('Games');
 for(const name of ['2048','Tetris','Breakout'])await expect(manager.getByRole('button',{name:`Open ${name}`,exact:true})).toBeVisible();
 await manager.getByRole('button',{name:'Open 2048',exact:true}).click();const first=await page.evaluate(()=>window.htmlTest.layout.getState().activeTabId);await ready(first,'2048');
 await probe(first,"(()=>{game.grid=new Grid(4);game.grid.insertTile(new Tile({x:0,y:0},2));game.grid.insertTile(new Tile({x:1,y:0},2));game.score=0;game.over=game.won=game.keepPlaying=false;game.actuate();document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',which:37,keyCode:37,bubbles:true}));return true})()");
 expect(await probe(first,'game.score')).toBe(4);const firstState=await probe(first,state2048);
 const second=await open('2048');expect(await probe(second,'game.score')).toBe(0);expect((await probe(first,'Tessera.ready')).instanceId).not.toBe((await probe(second,'Tessera.ready')).instanceId);
 expect(await probe(first,state2048)).toEqual(firstState);
 const tetris=await open('tetris');
 await probe(tetris,"(()=>{document.querySelector('#play').click();clearBlocks();for(let x=0;x<10;x++)if(x!==4&&x!==5)setBlock(x,19,i);setCurrentPiece({type:o,dir:0,x:4,y:0});document.querySelector('[data-action=drop]').click();panelGame.pause();return true})()");
 expect(await probe(tetris,'rows')).toBe(1);expect(await probe(tetris,'score')).toBe(110);expect(await probe(tetris,"document.querySelector('#score').textContent")).toBe('00110');
 const tetrisState=await probe(tetris,stateTetris);
 const breakout=await open('breakout');
 await probe(breakout,"(()=>{document.querySelector('#play').click();const brick=game.court.bricks.reduce((a,b)=>a.bottom>b.bottom?a:b);game.ball.setpos((brick.left+brick.right)/2,brick.bottom+game.ball.radius+1);game.ball.setdir(0,-1);game.ball.update(.02);panelGame.pause();return true})()");
 expect(await probe(breakout,'game.score.score')).toBeGreaterThan(0);const breakoutState=await probe(breakout,stateBreakout);
 for(const [id,slug] of [[first,'2048'],[tetris,'tetris'],[breakout,'breakout']]){
  expect((await probe(id,'Tessera.ready')).permissions).toEqual({network:[],panels:[],targets:[]});
  expect(await probe(id,"fetch('./LICENSE.txt').then(r=>r.text())")).toContain('Permission is hereby granted');
  expect((await probe(id,"fetch('./UPSTREAM.json').then(r=>r.json())")).commit).toMatch(/^[0-9a-f]{40}$/);
  expect(await probe(id,"Tessera.panels.list().then(()=>false,e=>String(e))")).toMatch(/permission.*not enabled/);
  expect(await probe(id,"Tessera.net.fetch('https://example.com').then(()=>false,e=>String(e))")).toMatch(/not been granted/);
  await invoke('browser_panel_action',{id,action:'reload'});await ready(id,slug);
 }
 expect(await probe(first,state2048)).toEqual(firstState);expect(await probe(tetris,stateTetris)).toEqual(tetrisState);expect(await probe(breakout,stateBreakout)).toEqual(breakoutState);
 console.log('PASS native Games library, three playable sandboxed packages, panel isolation, licenses, no optional permissions, saved boards across reload');
 await page.evaluate(id=>window.htmlTest.windows.detachPanel(id),breakout);await expect.poll(async()=>(await invoke('validation_info',{id:breakout})).parent,{timeout:15000}).toMatch(/^workspace-/);
 expect(await probe(breakout,stateBreakout)).toEqual(breakoutState);expect(await probe(breakout,'panelGame.paused')).toBe(true);
 await page.evaluate(id=>window.htmlTest.windows.movePanelToWindow(id,null),breakout);await expect.poll(async()=>(await invoke('validation_info',{id:breakout})).parent).toBe('main');
 expect(await probe(breakout,stateBreakout)).toEqual(breakoutState);
 const saved=await page.evaluate(()=>window.htmlTest.serializeWorkspace());await finish();
 await launch();await page.evaluate(saved=>window.htmlTest.deserializeWorkspace(saved),saved);
 for(const [id,slug] of [[first,'2048'],[second,'2048'],[tetris,'tetris'],[breakout,'breakout']])await ready(id,slug);
 expect(await probe(first,state2048)).toEqual(firstState);expect(await probe(second,'game.score')).toBe(0);expect(await probe(tetris,stateTetris)).toEqual(tetrisState);expect(await probe(breakout,stateBreakout)).toEqual(breakoutState);
 expect(await probe(tetris,'panelGame.paused')).toBe(true);expect(await probe(breakout,'panelGame.paused')).toBe(true);
 expect(errors).toEqual([]);
 console.log('PASS native detach/reattach and full Tessera restart preserve independent games; real-time games restore paused');
}catch(error){console.error(stderr.slice(-2000));throw error;}finally{await finish();}
