// Native WebView2 integration: no mock SDK or live agent/model requests.
// Build html_plugin_validation and start Vite on 1420 first.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const exe=fileURLToPath(new URL('../src-tauri/target/debug/examples/html_plugin_validation.exe',import.meta.url));
const folder=await mkdtemp(join(tmpdir(),'tessera-html-validation-'));
const manifest={id:'test.communicator',name:'Permission probe',version:'1.0.0',permissions:{network:['https://example.com'],panels:['list','read','send','receive']}};
await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest));
await writeFile(join(folder,'index.html'),'<meta charset="utf-8"><title>Permission probe</title><p>Isolated synthetic app</p>');
let child,browser,page,debugPort=9440+Math.floor(Math.random()*300),stderr='';
const errors=[];
async function launch(){
  debugPort++;
  child=spawn(exe,[],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`}});
  child.stderr.on('data',d=>{stderr+=d;});
  console.log('Owned HTML validation PID',child.pid);
  await expect.poll(async()=>{try{return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok;}catch{return false;}},{timeout:25000,message:()=>stderr}).toBe(true);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  await expect.poll(()=>{page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('html-plugin-fixture.html'));return !!page;},{timeout:15000}).toBe(true);
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>!!window.htmlTest,{},{timeout:25000});
}
async function finish(){
  if(page)await page.evaluate(()=>void window.htmlTest?.invoke('validation_exit')).catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(child?.exitCode===null)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,5000))]);
  if(child?.exitCode===null)child.kill();
  await expect.poll(async()=>{try{return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok;}catch{return false;}},{timeout:10000}).toBe(false);
  page=null;browser=null;child=null;
}
const invoke=(command,args={})=>page.evaluate(({command,args})=>window.htmlTest.invoke(command,args),{command,args});
async function probe(id,expression){const result=await invoke('validation_eval',{id,expression});if(!result.ok)throw Error(result.error);return result.value;}
async function rejects(id,expression,pattern){expect(await probe(id,`(async()=>{try{await (${expression});return 'ALLOWED'}catch(e){return String(e)}})()`)).toMatch(pattern);}
async function open(name){const id=await page.evaluate(name=>{window.htmlTest.creation.createPluginPanel(name);return window.htmlTest.layout.getState().activeTabId;},name);await ready(id);return id;}
async function ready(id){await expect.poll(async()=>{try{return await probe(id,'!!window.Tessera && !!document.body');}catch{return false;}},{timeout:25000}).toBe(true);return probe(id,'Tessera.ready');}
const close=id=>page.evaluate(id=>window.htmlTest.closePanel(id,false),id);
async function sample(name){const p=await invoke('html_plugin_sample',{sample:name});const m=await invoke('html_plugin_install',{ticket:p.ticket,grants:{network:[],panels:[],targets:[]}});await page.evaluate(m=>window.htmlTest.plugins.getState().registerHtmlApp(m),m);return m.name;}
const manager=()=>page.getByRole('dialog',{name:'Manage add-ons',exact:true});
async function openManager(){await page.getByRole('button',{name:'Plugins',exact:true}).click();await page.getByRole('button',{name:'Manage add-ons…',exact:true}).click();await expect(manager()).toBeVisible();}
try{
  await launch();
  await page.getByRole('button',{name:'Plugins',exact:true}).click();
  await page.getByRole('button',{name:'Import HTML app…',exact:true}).click();
  await manager().getByRole('button',{name:'Calculator',exact:true}).click();
  await expect(manager()).toContainText('No network or conversation access requested');
  await manager().getByRole('button',{name:/^(Install|Update) and open$/}).click();
  await expect(manager()).toHaveCount(0);
  const calculator=await page.evaluate(()=>window.htmlTest.layout.getState().activeTabId);
  const calculatorInfo=await ready(calculator);
  expect(calculatorInfo.permissions).toEqual({network:[],panels:[],targets:[]});
  expect((await probe(calculator,"fetch('./manifest.json').then(r=>r.json())")).name).toBe('Calculator');
  expect(await probe(calculator,"fetch('/html-other/revision/index.html').then(r=>r.status)")).toBe(403);
  expect(await probe(calculator,`(()=>{document.querySelector('#display').value='(12+3)*2';document.querySelector('[data-key="="]').click();return document.querySelector('#display').value})()`)).toBe('30');
  await rejects(calculator,"Tessera.panels.list()",/permission.*not enabled/i);
  await rejects(calculator,"Tessera.panels.read('synthetic-agent')",/not been granted/);
  await rejects(calculator,"Tessera.panels.send('synthetic-agent','hello')",/not been granted/);
  await rejects(calculator,"Tessera.net.fetch('https://example.com')",/not been granted/);
  await rejects(calculator,"window.__TAURI_INTERNALS__.invoke('validation_secret')",/cannot call Tessera/);
  await rejects(calculator,"window.__TAURI_INTERNALS__.invoke('html_plugin_install',{ticket:'forged',grants:{}})",/cannot call Tessera/);
  await rejects(calculator,"window.__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file',{path:'synthetic.txt',options:{}})",/not allowed|not permitted|denied/i);
  await rejects(calculator,"fetch('https://example.com')",/Failed to fetch|fetch/i);
  expect(await probe(calculator,'typeof RTCPeerConnection')).toBe('undefined');
  const originalUrl=(await invoke('validation_info',{id:calculator})).url;
  await probe(calculator,"(()=>{window.location.href='https://example.com';return true})()");
  expect((await invoke('validation_info',{id:calculator})).url).toBe(originalUrl);
  expect(await probe(calculator,"(()=>{const w=window.open('https://example.com');return w===null})()")).toBe(true);
  console.log('PASS real import/review/open UI, calculator, default-deny panel/network/host commands, CSP, navigation/popups');

  const notesName=await sample('notes'),notes=await open(notesName),noteText=`Native saved note ${Date.now()} ✓`;
  await expect.poll(()=>probe(notes,"!document.querySelector('#note').disabled")).toBe(true);
  await probe(notes,`(()=>{const n=document.querySelector('#note');n.value=${JSON.stringify(noteText)};n.dispatchEvent(new Event('input'));return true})()`);
  await expect.poll(()=>probe(notes,"document.querySelector('#status').textContent")).toBe('Saved');
  expect(await probe(calculator,"Tessera.storage.get('notes','missing')")).toBe('missing');
  await rejects(notes,"Tessera.storage.set('huge','x'.repeat(1100000))",/too large/);
  await close(notes);const notesAgain=await open(notesName);
  await expect.poll(()=>probe(notesAgain,"document.querySelector('#note').value")).toBe(noteText);
  await page.evaluate(id=>window.htmlTest.locks.getState().setLocked(id,true),notesAgain);
  const before=await probe(notesAgain,'Tessera.ready');
  await page.evaluate(id=>window.htmlTest.windows.detachPanel(id),notesAgain);
  await expect.poll(async()=>(await invoke('validation_info',{id:notesAgain})).parent,{timeout:15000}).toMatch(/^workspace-/);
  expect((await probe(notesAgain,'Tessera.ready')).instanceId).toBe(before.instanceId);
  expect(await probe(notesAgain,"document.querySelector('#note').value")).toBe(noteText);
  await page.evaluate(id=>window.htmlTest.windows.movePanelToWindow(id,null),notesAgain);
  await expect.poll(async()=>(await invoke('validation_info',{id:notesAgain})).parent,{timeout:15000}).toBe('main');
  expect(await page.evaluate(id=>window.htmlTest.locks.getState().lockedIds.has(id),notesAgain)).toBe(true);
  console.log('PASS notes persist across close/reopen, per-app storage isolation/quota, native detach/reparent retains state and lock');

  const preview=await invoke('html_plugin_inspect',{path:folder});
  const app=await invoke('html_plugin_install',{ticket:preview.ticket,grants:{network:[],panels:[],targets:[]}});
  await page.evaluate(m=>window.htmlTest.plugins.getState().registerHtmlApp(m),app);
  const comm=await open(app.name);
  await openManager();await manager().getByRole('button',{name:'Permissions for Permission probe',exact:true}).click();
  expect(await manager().getByRole('checkbox').evaluateAll(nodes=>nodes.every(n=>!n.checked))).toBe(true);
  await manager().getByLabel('See selected panel names').check();
  await manager().getByLabel('Receive messages from selected agents').check();
  await manager().getByLabel('Send messages to selected agents').check();
  await manager().getByLabel('https://example.com',{exact:true}).check();
  await manager().getByLabel(/Synthetic Claude/).check();
  await manager().getByRole('button',{name:'Save permissions',exact:true}).click();
  await manager().getByRole('button',{name:'Close add-on manager'}).click();
  expect((await probe(comm,'Tessera.panels.list()')).map(p=>p.id)).toEqual(['synthetic-agent']);
  await rejects(comm,"Tessera.panels.read('synthetic-agent')",/not been granted/);
  await rejects(comm,"Tessera.panels.send('unapproved-agent','blocked')",/not been granted/);
  await rejects(comm,"Tessera.panels.send('synthetic-agent',{message:'blocked',waitForReply:true})",/requires read permission/);
  await rejects(comm,"Tessera.net.fetch('https://127.0.0.1')",/not been granted/);
  expect((await probe(comm,"Tessera.net.fetch('https://example.com')")).status).toBe(200);
  const receipt=await invoke('validation_tool',{caller:'synthetic-agent',tool:'send_to_panel',args:{panel:comm,message:'synthetic inbox message'}});
  expect(receipt.queued).toBe(true);
  const unapproved=await invoke('validation_tool',{caller:'unapproved-agent',tool:'list_panels',args:{}});
  expect(unapproved.panels.some(p=>p.id===comm)).toBe(false);
  await probe(comm,"(()=>{window.received=[];window.stopMessages=Tessera.panels.onMessage(m=>window.received.push(m.message));return true})()");
  await expect.poll(()=>probe(comm,'window.received')).toEqual(['synthetic inbox message']);
  const peer=await open(app.name);
  await invoke('html_plugin_permissions',{plugin:app.name,grants:{network:[],panels:['send','receive'],targets:[comm,peer]}});
  await probe(peer,"(()=>{window.peerReceived=[];window.stopPeer=Tessera.panels.onMessage(async m=>{window.peerReceived.push(m.message);await m.reply('reply from HTML peer')});return true})()");
  expect((await probe(comm,`Tessera.panels.send(${JSON.stringify(peer)},'SDK to panel bus')`)).queued).toBe(true);
  await expect.poll(()=>probe(peer,'window.peerReceived')).toEqual(['SDK to panel bus']);
  await expect.poll(()=>probe(comm,'window.received')).toEqual(['synthetic inbox message','reply from HTML peer']);
  await probe(peer,'window.stopPeer()');await close(peer);
  await invoke('html_plugin_permissions',{plugin:app.name,grants:{network:[],panels:['list'],targets:['old-restored-panel','unchanged-panel']}});
  await invoke('html_plugin_remap_targets',{mapping:{'old-restored-panel':'restored-panel','unapproved-agent':'new-unapproved'}});
  expect((await invoke('html_plugin_permissions',{plugin:app.name,grants:null})).targets).toEqual(['restored-panel','unchanged-panel']);
  await invoke('html_plugin_permissions',{plugin:app.name,grants:{network:[],panels:[],targets:[]}});
  await rejects(comm,'Tessera.panels.list()',/permission.*not enabled/i);
  await rejects(comm,"Tessera.net.fetch('https://example.com')",/not been granted/);
  await probe(comm,'window.stopMessages()');
  console.log('PASS optional network grant, scoped MCP inbox, bidirectional SDK/bus messaging, prohibited reads/sends, exact restore mapping and immediate revocation');

  await openManager();await manager().getByRole('button',{name:'Remove Quick Notes',exact:true}).click();
  await manager().getByRole('button',{name:'Confirm removal of Quick Notes',exact:true}).click();
  await expect.poll(()=>page.evaluate(name=>[...window.htmlTest.plugins.getState().instances.values()].filter(p=>p.pluginName===name).length,notesName)).toBe(0);
  await manager().locator('summary').click();await manager().getByRole('button',{name:'Restore Quick Notes',exact:true}).click();
  await manager().getByRole('button',{name:'Close add-on manager'}).click();
  const restored=await open(notesName);await expect.poll(()=>probe(restored,"document.querySelector('#note').value")).toBe(noteText);
  const gameName=await sample('memory'),game=await open(gameName);
  expect(await probe(game,"document.querySelectorAll('.card').length")).toBe(16);
  expect(await probe(game,"(async()=>{const pairs=new Map();cards.forEach((s,i)=>pairs.set(s,[...(pairs.get(s)||[]),i]));for(const [a,b] of pairs.values()){await flip(a);await flip(b)}return matched.size})()")).toBe(16);
  expect(await probe(game,"Tessera.storage.get('best')")).toBe(8);
  const names={notes:notesName,calculator:calculatorInfo.pluginName,game:gameName};
  const saved=await page.evaluate(()=>window.htmlTest.serializeWorkspace());
  await page.screenshot({path:join(folder,'apps.png')});
  console.log('PASS remove/restore retains data, bundled memory game completion and score persistence');
  await finish();await launch();
  await page.evaluate(snapshot=>window.htmlTest.deserializeWorkspace(snapshot),saved);
  const restoredIds=await page.evaluate(()=>[...window.htmlTest.plugins.getState().instances.values()].map(p=>({id:p.id,name:p.pluginName})));
  const restartedNotes=restoredIds.find(p=>p.name===names.notes).id;
  await ready(restartedNotes);await expect.poll(()=>probe(restartedNotes,"document.querySelector('#note').value")).toBe(noteText);
  const restartedGame=restoredIds.find(p=>p.name===names.game).id;
  await ready(restartedGame);expect(await probe(restartedGame,"Tessera.storage.get('best')")).toBe(8);
  expect((await invoke('html_plugin_permissions',{plugin:app.name,grants:null})).targets).toEqual([]);
  expect(errors.filter(e=>!e.includes('WebSocket closed'))).toEqual([]);
  console.log('PASS full native app restart restores app panels, notes, scores, and revoked permissions');
}catch(error){console.error(stderr,errors);if(page)console.error(await page.evaluate(()=>({windows:window.htmlTest?.workspaces.getState().windows,visible:!document.hidden,errors:[...document.querySelectorAll('.browser-error')].map(e=>e.textContent)})).catch(()=>{}));throw error;}
finally{await finish();if(dirname(resolve(folder))!==resolve(tmpdir())||!basename(folder).startsWith('tessera-html-validation-'))throw Error('Invalid validation cleanup path');await rm(folder,{recursive:true,force:true});}
