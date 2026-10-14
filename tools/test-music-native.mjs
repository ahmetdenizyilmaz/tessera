// Real Windows media session + real sandboxed HTML app. Controls only the
// synthetic silent player provided by the example, never the user's music.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const exe=fileURLToPath(new URL('../src-tauri/target/debug/examples/html_plugin_validation.exe',import.meta.url));
let child,browser,page,port=9750+Math.floor(Math.random()*200),stderr='',errors=[];
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.htmlTest.invoke(command,args),{command,args});
async function probe(id,expression){const r=await invoke('validation_eval',{id,expression});if(!r.ok)throw Error(r.error);return r.value;}
async function launch(){port++;child=spawn(exe,[],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});child.stderr.on('data',d=>stderr+=d);console.log('Owned music validation PID',child.pid);await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},{timeout:25000}).toBe(true);browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);await expect.poll(()=>{page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('html-plugin-fixture.html'));return !!page;},{timeout:20000}).toBe(true);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.htmlTest);}
async function finish(){if(page)await invoke('validation_exit').catch(()=>{});if(browser)await browser.close().catch(()=>{});if(child?.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);if(child?.exitCode===null)child.kill();child=null;browser=null;page=null;}
const plugin='html-tessera.music-remote';
try{
 await launch();await invoke('html_plugin_set_enabled',{plugin,enabled:true});await invoke('html_plugin_permissions',{plugin,grants:{network:[],panels:[],targets:[],media:[]}});
 const id=await page.evaluate(name=>{window.htmlTest.plugins.getState().setPluginRemoved(name,false);window.htmlTest.creation.createPluginPanel(name);return window.htmlTest.layout.getState().activeTabId;},plugin);
 await expect.poll(async()=>{try{return await probe(id,'!!window.Tessera && !!document.querySelector("#enable")');}catch{return false;}},{timeout:20000}).toBe(true);
 expect(await probe(id,"Tessera.media.snapshot().then(()=>false,e=>String(e))")).toMatch(/permission.*not enabled/);
 await probe(id,"(()=>{document.querySelector('#enable').click();return true})()");
 const manager=page.getByRole('dialog',{name:'App library',exact:true});await expect(manager).toBeVisible();
 await manager.getByRole('checkbox',{name:'See players, current song, and cover art'}).check();await manager.getByRole('checkbox',{name:/Control playback:/}).check();await manager.getByRole('button',{name:'Save permissions',exact:true}).click();await manager.getByRole('button',{name:'Close add-on manager',exact:true}).click();
 await invoke('validation_media',{action:'start'});
 let selected;
 await expect.poll(async()=>{const s=await probe(id,'Tessera.media.snapshot()');selected=s.sessions.find(s=>s.title==='Tessera validation track');return !!selected;},{timeout:20000}).toBe(true);
 await expect.poll(()=>probe(id,`[...document.querySelector('#source').options].some(o=>o.value===${JSON.stringify(selected.id)})`),{timeout:15000}).toBe(true);
 await probe(id,`(()=>{const s=document.querySelector('#source');s.value=${JSON.stringify(selected.id)};s.dispatchEvent(new Event('change'));return true})()`);
 await expect.poll(()=>probe(id,"document.querySelector('#title').textContent"),{timeout:15000}).toBe('Tessera validation track');
 await expect.poll(()=>probe(id,"!document.querySelector('#cover').hidden && document.querySelector('#cover').naturalWidth>0"),{timeout:15000}).toBe(true);
 const musicPage=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/html-tessera.music-remote/'));
 if(musicPage)await musicPage.screenshot({path:'.tmp/music-remote.png'});
 for(const [button,action] of [['play','pause'],['play','play'],['next','next'],['previous','previous']]){
   await probe(id,`(()=>{document.querySelector('#${button}').click();return true})()`);
   await expect.poll(()=>invoke('validation_media',{action:'events'}),{timeout:10000}).toContain(action);
   if(action==='pause'||action==='play')await expect.poll(()=>probe(id,"document.querySelector('#play').getAttribute('aria-label')"),{timeout:10000}).toBe(action==='pause'?'Play':'Pause');
 }
 const snapshot=await probe(id,`Tessera.media.snapshot(${JSON.stringify(selected.id)})`);
 if(snapshot.current.controls.seek){await probe(id,"(()=>{const s=document.querySelector('#seek');s.value=60;s.dispatchEvent(new Event('change'));return true})()");await expect.poll(()=>invoke('validation_media',{action:'events'})).toContain('seek:60');}
 await probe(id,"(()=>{document.querySelector('#settings-toggle').click();document.querySelector('#show-cover').click();document.querySelector('[data-color=\"#c4b5fd\"]').click();return true})()");
 await expect.poll(()=>probe(id,"Tessera.storage.get('preferences',null,'panel')")).toMatchObject({showCover:false,accent:'#c4b5fd'});
 await page.evaluate(id=>window.htmlTest.appearance.getState().setPanel(id,{mode:'color',color:'#272139',fit:'cover',dim:35}),id);
 await expect.poll(()=>probe(id,"getComputedStyle(document.documentElement).backgroundColor")).toBe('rgb(39, 33, 57)');
 await invoke('browser_panel_action',{id,action:'reload'});await expect.poll(()=>probe(id,"getComputedStyle(document.documentElement).backgroundColor"),{timeout:15000}).toBe('rgb(39, 33, 57)');
 await expect.poll(()=>probe(id,"document.querySelector('#show-cover').checked")).toBe(false);
 await page.evaluate(id=>window.htmlTest.windows.detachPanel(id),id);await expect.poll(async()=>(await invoke('validation_info',{id})).parent,{timeout:15000}).toMatch(/^workspace-/);
 expect(await probe(id,"getComputedStyle(document.documentElement).backgroundColor")).toBe('rgb(39, 33, 57)');
 await page.evaluate(id=>window.htmlTest.windows.movePanelToWindow(id,null),id);await expect.poll(async()=>(await invoke('validation_info',{id})).parent).toBe('main');
 await invoke('html_plugin_permissions',{plugin,grants:{network:[],panels:[],targets:[],media:['read']}});
 expect(await probe(id,`Tessera.media.control(${JSON.stringify(selected.id)},'next').then(()=>false,e=>String(e))`)).toMatch(/permission.*not enabled/);
 await expect.poll(()=>probe(id,"document.querySelector('#next').disabled")).toBe(true);
 await invoke('html_plugin_permissions',{plugin,grants:{network:[],panels:[],targets:[],media:[]}});
 expect(await probe(id,'Tessera.media.snapshot().then(()=>false,e=>String(e))')).toMatch(/permission.*not enabled/);
 await expect.poll(()=>probe(id,"document.querySelector('#now').hidden")).toBe(true);
 const saved=await page.evaluate(()=>window.htmlTest.serializeWorkspace());await invoke('validation_media',{action:'stop'});await finish();
 await launch();await page.evaluate(saved=>window.htmlTest.deserializeWorkspace(saved),saved);
 await expect.poll(async()=>{try{return await probe(id,"!!window.Tessera && !!document.querySelector('#show-cover')");}catch{return false;}},{timeout:20000}).toBe(true);
 await expect.poll(()=>probe(id,"document.querySelector('#show-cover').checked")).toBe(false);
 await expect.poll(()=>probe(id,"getComputedStyle(document.documentElement).backgroundColor")).toBe('rgb(39, 33, 57)');
 await invoke('html_plugin_permissions',{plugin,grants:{network:[],panels:[],targets:[],media:['read']}});
 await invoke('validation_media',{action:'start'});
 await expect.poll(()=>probe(id,"document.querySelector('#title').textContent"),{timeout:15000}).toBe('Tessera validation track');
 expect(await probe(id,"document.querySelector('#source').value")).not.toBe(selected.id);
 expect(await probe(id,"document.querySelector('#play').disabled")).toBe(true);
 await invoke('validation_media',{action:'stop'});
 expect(errors).toEqual([]);console.log('PASS real Windows media session, cover art, play/pause/next/previous, seek when supported, grant/revoke UI and enforcement, music preferences, app background reload/detach/full restart, selected player reconnects after restart');
}catch(error){console.error(stderr.slice(-3000));throw error;}finally{await finish();}
