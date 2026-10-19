import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1200,height:860}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const dialog=()=>page.getByRole('dialog',{name:'Panel background',exact:true});
try{
 await page.goto('http://127.0.0.1:1420/tools/appearance-fixture.html');await page.waitForFunction(()=>!!window.terminals?.first);
 await page.locator('[data-panel-id="first"]').getByRole('button',{name:'Panel appearance',exact:true}).click();
 const scope=()=>dialog().getByRole('checkbox',{name:'Apply to other panels',exact:true});
 await expect(scope()).not.toBeChecked();await expect(dialog().getByRole('checkbox')).toHaveCount(1);
 await expect(dialog().getByRole('button',{name:'This panel',exact:true})).toHaveCount(0);await expect(dialog().getByRole('button',{name:'All panels',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>window.appearance.getState().panels.first)).toBeUndefined();
 await dialog().getByRole('button',{name:'Solid color',exact:true}).click();await dialog().getByRole('button',{name:'Use #ffffff',exact:true}).click();
 expect(await page.evaluate(()=>window.terminals.first.options.theme.background)).toBe('#00000000');expect(await page.evaluate(()=>window.terminals.first.options.theme.foreground)).toBe('#17212d');
 expect(await page.locator('[data-panel-id="first"] .xterm-viewport').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 await scope().check();await dialog().getByRole('button',{name:'Solid color',exact:true}).click();await dialog().getByRole('button',{name:'Use #272139',exact:true}).click();
 expect(await page.evaluate(()=>window.appearance.getState().panels.first.color)).toBe('#ffffff');
 expect(await page.locator('[data-panel-id="second"] .panel-appearance').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe('rgb(39, 33, 57)');
 await scope().uncheck();await expect(dialog().getByRole('button',{name:'Use #ffffff',exact:true})).toHaveAttribute('aria-pressed','true');await dialog().getByRole('button',{name:'Image',exact:true}).click();
 const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=300;c.height=150;const x=c.getContext('2d');x.fillStyle='#35594d';x.fillRect(0,0,300,150);x.fillStyle='#8ec9a7';x.fillRect(0,0,150,150);return c.toDataURL('image/jpeg').split(',')[1];});
 await dialog().getByLabel('Choose background image',{exact:true}).setInputFiles({name:'office.jpg',mimeType:'image/jpeg',buffer:Buffer.from(jpeg,'base64')});
 await expect.poll(()=>page.evaluate(()=>window.appearance.getState().panels.first.imageId)).toBeTruthy();
 for(const name of ['Fit','Stretch','Center','Tile','Fill']){await dialog().getByRole('button',{name,exact:true}).click();await expect(dialog().getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');}
 await dialog().getByRole('button',{name:'Fit',exact:true}).click();
 await page.screenshot({path:'.tmp/background-scope-panel.png'});
 await scope().check();await dialog().getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('[data-panel-id="first"]').getByRole('button',{name:'Panel appearance',exact:true}).click();await expect(scope()).not.toBeChecked();await expect(dialog().getByRole('button',{name:'Fit',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.setViewportSize({width:360,height:640});const panelBox=await dialog().boundingBox();expect(panelBox.x).toBeGreaterThanOrEqual(0);expect(panelBox.x+panelBox.width).toBeLessThanOrEqual(360);await page.screenshot({path:'.tmp/background-scope-compact.png'});await page.setViewportSize({width:1200,height:860});await dialog().getByRole('button',{name:'Done',exact:true}).click();
 const saved=await page.evaluate(()=>window.appearance.getState().panels.first);await page.reload();await page.waitForFunction(()=>!!window.terminals.first);
 expect(await page.evaluate(()=>window.appearance.getState().panels.first)).toEqual(saved);
 await expect.poll(()=>page.locator('[data-panel-id="first"] .panel-appearance').evaluate(e=>getComputedStyle(e).backgroundImage.includes('data:image/jpeg'))).toBe(true);
 expect(await page.locator('[data-panel-id="first"] .panel-appearance').evaluate(e=>getComputedStyle(e).backgroundSize)).toContain('contain');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('group',{name:'App theme',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/Appearance/}).click();await expect(page.getByText('Default background for panels',{exact:false})).toBeVisible();await expect(page.getByRole('checkbox',{name:'Apply to other panels'})).toHaveCount(0);
 await page.getByRole('button',{name:'Theme default',exact:true}).click();
 await page.evaluate(()=>{window.originalTerminal=window.terminals.second;window.originalCustom=JSON.stringify(window.terminals.first.options.theme);window.originalPanels=JSON.stringify(window.appearance.getState().panels);});
 for(const label of ['White','Gray','Light','Nord','Dark']){
  await page.getByRole('group',{name:'App theme',exact:true}).getByRole('button',{name:label,exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',label.toLowerCase());
  const colors=await page.evaluate(()=>{const css=getComputedStyle(document.documentElement),theme=window.terminals.second.options.theme;const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');const rgba=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};return {background:theme.background,foreground:theme.foreground,cursor:theme.cursor,cssBackground:css.getPropertyValue('--bg-primary').trim(),cssForeground:css.getPropertyValue('--text-primary').trim(),cssAccent:css.getPropertyValue('--accent').trim(),renderedBackground:window.terminals.second._core._themeService.colors.background.rgba>>>0,rgba:rgba(theme.background),foregroundRgba:rgba(theme.foreground),sameTerminal:window.originalTerminal===window.terminals.second,customUnchanged:window.originalCustom===JSON.stringify(window.terminals.first.options.theme),panelsUnchanged:window.originalPanels===JSON.stringify(window.appearance.getState().panels)};});
  expect(colors.background).toBe(colors.cssBackground);expect(colors.foreground).toBe(colors.cssForeground);expect(colors.cursor).toBe(colors.cssAccent);
  expect(colors.renderedBackground).toBe(((colors.rgba[0]<<24)|(colors.rgba[1]<<16)|(colors.rgba[2]<<8)|255)>>>0);
  const light=label==='White'||label==='Light';expect(colors.rgba[0]>colors.foregroundRgba[0]).toBe(light);
  expect(colors.sameTerminal).toBe(true);expect(colors.customUnchanged).toBe(true);expect(colors.panelsUnchanged).toBe(true);
 }
 await page.getByRole('group',{name:'App theme',exact:true}).getByRole('button',{name:'Nord',exact:true}).click();await page.screenshot({path:'.tmp/appearance-theme-settings.png'});
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.waitForFunction(()=>!!window.terminals.first);
 await expect(page.locator('html')).toHaveAttribute('data-theme','nord');expect(await page.evaluate(()=>window.appearance.getState().panels.first)).toEqual(saved);
 expect(await page.evaluate(()=>window.terminals.second.options.theme.background)).toBe(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()));
 await page.getByRole('button',{name:'About',exact:true}).click();const about=page.getByRole('dialog',{name:'Tessera',exact:true});await expect(about).toContainText('Ahmet Deniz YILMAZ');await expect(about.getByRole('link',{name:'ady.com.tr'})).toHaveAttribute('href','https://ady.com.tr');
 const scroll=about.getByRole('region',{name:'Browse keyboard shortcuts'});expect(await scroll.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);await about.getByRole('searchbox').fill('F11');await expect(about.locator('.about-key')).toHaveCount(1);await about.getByRole('searchbox').fill('');
 await about.getByRole('link',{name:'ady.com.tr'}).click();expect(await page.evaluate(()=>window.calls.some(c=>c.command==='plugin:shell|open'&&c.args.path==='https://ady.com.tr'))).toBe(true);
 await page.screenshot({path:'.tmp/about-refreshed.png'});
 for(const size of [{width:420,height:640},{width:700,height:440}]){await page.setViewportSize(size);const box=await about.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(size.height);await expect(about.getByRole('button',{name:'Done',exact:true})).toBeVisible();}
 await about.getByRole('button',{name:'Done',exact:true}).click();
 for(const size of [{width:1200,height:860},{width:700,height:600},{width:360,height:600}]){await page.setViewportSize(size);const status=page.locator('.status-bar');const box=await status.boundingBox();for(const label of await page.locator('.resource-label,.resource-value').all()){const r=await label.boundingBox();expect(r.y).toBeGreaterThanOrEqual(box.y);expect(r.y+r.height).toBeLessThanOrEqual(box.y+box.height);}expect(await status.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);}
 expect(errors).toEqual([]);console.log('PASS single background scope toggle, local/global isolation, image upload/fit/restart, all five live terminal themes without recreation, custom background preservation, theme persistence, About credits/link/search/scroll/responsiveness, and CPU/RAM single-row layout');
}catch(error){console.error('Page errors:',errors);throw error;}finally{await browser.close();}
