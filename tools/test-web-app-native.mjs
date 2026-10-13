// Run after building the web_app_validation example and starting Vite on 1420.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const executable=new URL('../src-tauri/target/debug/examples/web_app_validation.exe',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const nonce=Date.now().toString(), cookie=`tessera_validation_${nonce}=kept`, requests=[];
const server=createServer((req,res)=>{
  requests.push({path:req.url,cookie:req.headers.cookie??''});
  if(req.url.endsWith('/seed'))res.setHeader('Set-Cookie',`${cookie}; HttpOnly; Path=/web-test-${nonce}/; Max-Age=600; SameSite=Lax`);
  res.setHeader('Content-Type','text/html');res.end('<title>Synthetic cookie test</title><p>Web app persistence test</p>');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}/web-test-${nonce}`;
let process, browser, main, debugPort=9250;
async function launch(){
  debugPort++;
  process=spawn(executable,[],{windowsHide:true,stdio:'ignore',env:{...globalThis.process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`}});
  console.log(`Owned native web validation PID ${process.pid}`);
  await expect.poll(async()=>{try{return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok;}catch{return false;}},{timeout:20000}).toBe(true);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`,{timeout:10000});
  await expect.poll(()=>{main=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('web-app-native.html'));return !!main;},{timeout:15000}).toBe(true);
  await main.waitForFunction(()=>!!window.webTest,{},{timeout:20000});
}
async function finish(){
  if(main)await main.evaluate(()=>{void window.webTest.exit();}).catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(process && process.exitCode===null)await Promise.race([once(process,'exit'),new Promise(resolve=>setTimeout(resolve,8000))]);
  if(process && process.exitCode===null)process.kill();
  await expect.poll(async()=>{try{return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok;}catch{return false;}},{timeout:10000}).toBe(false);
  main=null;browser=null;process=null;
}
async function open(path,id='cookie-panel'){
  await main.evaluate(({url,id})=>window.webTest.create(id,url),{url:`${base}/${path}`,id});
  await expect.poll(()=>requests.some(r=>r.path===`/web-test-${nonce}/${path}`),{timeout:15000}).toBe(true);
}
try {
  await launch();await open('seed');await main.evaluate(()=>window.webTest.close());
  await open('reopened','another-panel');
  expect(requests.find(r=>r.path.endsWith('/reopened')).cookie).toContain(cookie);
  console.log('PASS native cookie survives closing and recreating the website panel');
  await main.evaluate(()=>window.webTest.close('another-panel'));await finish();
  await launch();await open('restarted');
  expect(requests.find(r=>r.path.endsWith('/restarted')).cookie).toContain(cookie);
  await main.evaluate(()=>window.webTest.close());
  console.log('PASS native HttpOnly cookie survives closing/recreating a panel and a full native app restart with the stable app profile');
  const home=`${base}/configured?mode=compact#/library`;
  await main.evaluate(home=>window.webTest.create('configured-panel',home),home);
  await expect.poll(()=>requests.filter(r=>r.path.endsWith('/configured?mode=compact')).length,{timeout:15000}).toBe(1);
  const status=await main.evaluate(()=>window.webTest.status('configured-panel'));
  expect(status.url).toBe(home);
  await main.evaluate(()=>window.webTest.close('configured-panel'));
  await main.evaluate(({home,url})=>window.webTest.create('restored-configured-panel',home,url),{home,url:status.url});
  await expect.poll(()=>requests.filter(r=>r.path.endsWith('/configured?mode=compact')).length,{timeout:15000}).toBe(2);
  await main.evaluate(()=>window.webTest.close('restored-configured-panel'));
  console.log('PASS native saved custom home retains query parameters and hash routing on panel restore');
}finally{await finish();server.close();}
