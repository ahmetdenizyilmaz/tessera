// UI integration for large libraries and a synthetic GitHub catalog. Native
// archive/checksum/permission validation is covered by Rust + native tests.
import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1200,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const manager=()=>page.getByRole('dialog',{name:'App library',exact:true});
try {
  await page.goto('http://127.0.0.1:1420/tools/window-fixture.html?addons');
  await page.waitForFunction(()=>!!window.creation);
  await page.evaluate(async()=>{
    const {mockIPC}=await import('/node_modules/@tauri-apps/api/mocks.js');
    window.catalogCalls=[];
    const app={id:'community.chess-clock',name:'Chess Clock',version:'1.0.0',description:'A two-player clock',category:'Games',icon:'Timer',package:'packages/clock.zip',sha256:'a'.repeat(64)};
    const permissions={network:['https://example.com'],panels:['send']};
    mockIPC(async(command,args)=>{
      window.catalogCalls.push({command,args});
      if(command==='html_catalog_list')return {ticket:'catalog-ticket',repository:'https://github.com/example/apps',commit:'b'.repeat(40),apps:[app]};
      if(command==='html_catalog_preview')return {ticket:'review-ticket',pluginName:'html-'+app.id,fileCount:2,bytes:2000,replaces:null,source:'https://github.com/example/apps',manifest:{...app,permissions}};
      if(command==='html_plugin_install')return {name:'html-'+app.id,defaultTitle:app.name,version:app.version,description:app.description,entry:'index.html',icon:app.icon,htmlPlugin:true,browserSite:'html-'+app.id,permissions,enabled:true};
      if(command==='html_plugin_targets')return [];
      if(command==='browser_panel_status')return {url:'https://lichess.org/analysis'};
      return null;
    },{shouldMockEvents:true});
    for(let i=0;i<60;i++)window.plugins.getState().registerHtmlApp({name:`html-test.app-${i}`,defaultTitle:`Tool ${i}`,version:'1',description:'Example tool',entry:'index.html',icon:'Calculator',htmlPlugin:true,browserSite:`html-test.app-${i}`});
    window.creation.openNewSessionWizard();
  });
  await expect(page.locator('.nsw-more button')).toHaveCount(3);
  await page.getByRole('button',{name:'App library',exact:true}).click();
  await expect(manager().getByRole('button',{name:'Open Notes',exact:true})).toBeVisible();
  await expect(manager().getByRole('button',{name:'Open Notepad',exact:true})).toHaveCount(0);
  await manager().getByLabel('Search installed apps').fill('clock');
  await expect(manager().getByRole('button',{name:/^Open /})).toHaveCount(1);
  await manager().getByLabel('Search installed apps').fill('');
  await manager().getByLabel('App category',{exact:true}).selectOption('Games');
  await expect(manager().getByRole('button',{name:'Open Memory Break',exact:true})).toBeVisible();
  await expect(manager().getByRole('button',{name:'Open Timer',exact:true})).toHaveCount(0);
  await manager().getByRole('button',{name:'Get apps',exact:true}).click();
  expect(await page.evaluate(()=>window.catalogCalls.filter(c=>c.command==='html_catalog_list').length)).toBe(0);
  await manager().getByLabel('GitHub repository URL').fill('https://github.com/example/apps');
  await manager().getByRole('button',{name:'Load catalog',exact:true}).click();
  await expect(manager().getByRole('heading',{name:'Chess Clock',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('tessera-app-catalog')).repositoryUrl)).toBe('https://github.com/example/apps');
  await manager().getByRole('button',{name:'Download and review',exact:true}).click();
  await expect(manager()).toContainText('Source: https://github.com/example/apps');
  expect(await manager().getByRole('checkbox').evaluateAll(nodes=>nodes.every(n=>!n.checked))).toBe(true);
  await manager().getByRole('button',{name:'Install and open',exact:true}).click();
  await expect(manager()).toHaveCount(0);
  expect(await page.evaluate(()=>window.catalogCalls.find(c=>c.command==='html_plugin_install').args.grants)).toEqual({network:[],panels:[],targets:[]});
  expect(await page.evaluate(()=>window.plugins.getState().instances.get(window.layout.getState().activeTabId).pluginName)).toBe('html-community.chess-clock');
  expect(await page.evaluate(()=>Object.values(window.layout.getState().widgetKinds).includes('new-session'))).toBe(false);
  await page.getByRole('button',{name:'Apps',exact:true}).click();
  expect(await page.locator('.menu-dropdown button').count()).toBeLessThanOrEqual(7); // Five shortcuts + import/library.
  await page.getByRole('button',{name:'App library…',exact:true}).click();
  await manager().getByLabel('Search installed apps').fill('Chess Clock');
  await expect(manager().getByRole('button',{name:'Open Chess Clock',exact:true})).toBeVisible();
  await page.screenshot({path:'.tmp/app-library.png'});
  await page.setViewportSize({width:420,height:640});
  const box=await manager().boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(420);expect(box.y+box.height).toBeLessThanOrEqual(640);
  expect(errors).toEqual([]);
  console.log('PASS 60-app library, categories/search, compact New Session, GitHub source/review/install with default-deny permissions, correct wizard placement, and narrow layout');
}finally{await browser.close();}
