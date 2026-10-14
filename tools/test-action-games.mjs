// Actual gameplay, offline assets, persistence and panel bounds in Edge.
// Run with Vite on port 1420. Native coverage: test-action-games-native.mjs.
import {chromium, expect} from '@playwright/test';
const browser = await chromium.launch({channel: 'msedge', headless: true});
const context = await browser.newContext({viewport: {width: 800, height: 650}});
const page = await context.newPage();
const errors = [], failed = [], remote = [];
page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:1420/')) remote.push(r.url()); });
async function open(slug) {
  await page.goto(`http://127.0.0.1:1420/examples/html-apps/${slug}/index.html`);
  await page.waitForFunction(() => !!window.panelGame, null, {timeout: 10000});
}
async function layouts(slug, selector) {
  for (const [width, height] of [[800,650], [420,600], [280,420], [1100,450]]) {
    await page.setViewportSize({width,height});
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await expect.poll(async () => { const b = await page.locator(selector).boundingBox(); return b.x >= -1 && b.y >= 0 && b.x + b.width <= width + 1 && b.y + b.height <= height + 1; }).toBe(true);
  }
  await page.setViewportSize({width:800,height:650});
  await page.screenshot({path:`.tmp/action-game-${slug}.png`});
}
try {
  await open('menja');
  await page.getByRole('button', {name: 'PLAY GAME', exact:true}).click();
  // Place a normal target in the center, then slice it using real pointer input.
  await page.evaluate(() => { resetAllTargets(); spawnTime=100000; const t=getTarget(); t.x=0;t.y=0;t.z=0;t.xD=t.yD=0;t.health=1;t.maxHealth=1;targets.push(t); });
  await page.mouse.move(250,325); await page.mouse.down(); await page.waitForTimeout(30);
  await page.mouse.move(550,325, {steps:4}); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => state.game.cubeCount)).toBeGreaterThan(0);
  expect(await page.evaluate(() => state.game.score)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Pause game',exact:true}).click();
  const menja = await page.evaluate(() => ({score:state.game.score,time:state.game.time}));
  await page.waitForTimeout(200); expect(await page.evaluate(() => ({score:state.game.score,time:state.game.time}))).toEqual(menja);
  await layouts('menja','#c'); expect(await page.evaluate(() => state.game.time)).toBe(menja.time);
  await page.reload(); await page.waitForFunction(() => !!window.panelGame); expect(await page.evaluate(() => panelGame.best)).toBe(menja.score);
  await page.getByRole('button',{name:'CASUAL MODE',exact:true}).click(); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => panelGame.paused)).toBe(true);
  await page.getByRole('button',{name:'Credits & source',exact:true}).click(); await expect(page.locator('#license')).toContainText('GNU GENERAL PUBLIC LICENSE');
  await page.keyboard.press('Escape'); expect(await page.evaluate(() => panelGame.paused)).toBe(true);
  console.log('PASS Menja: real pointer slicing, scoring, paused resize, saved best, casual mode, blur pause, license');

  await open('onoff');
  expect(await page.evaluate(() => panelGame.paused)).toBe(true);
  await page.getByRole('button',{name:'Play level 1',exact:true}).click();
  const x = await page.evaluate(() => game.scene.guy.x);
  await page.keyboard.down('d'); await page.waitForTimeout(120); await page.keyboard.up('d');
  expect(await page.evaluate(() => game.scene.guy.x)).toBeGreaterThan(x);
  const groundY = await page.evaluate(() => game.scene.guy.y);
  await page.keyboard.down('w'); await page.waitForTimeout(80); await page.keyboard.up('w');
  expect(await page.evaluate(() => game.scene.guy.y)).toBeLessThan(groundY);
  await page.keyboard.press('Space'); expect(await page.evaluate(() => game.scene.on)).toBe(false);
  await page.keyboard.press('Space');
  // Reach the real goal to exercise the level transition and checkpoint.
  await page.evaluate(() => { game.scene.guy.x=game.scene.goal.x; game.scene.guy.y=game.scene.goal.y+game.scene.goal.height-game.scene.guy.height; game.scene.guy.vx=game.scene.guy.vy=0; });
  await expect.poll(() => page.evaluate(() => panelGame.level),{timeout:6000}).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => panelGame.paused)).toBe(true);
  const pos = await page.evaluate(() => ({x:game.scene.guy.x,y:game.scene.guy.y}));
  await layouts('onoff','#game'); expect(await page.evaluate(() => ({x:game.scene.guy.x,y:game.scene.guy.y}))).toEqual(pos);
  await page.reload(); await page.waitForFunction(() => !!window.panelGame);
  expect(await page.evaluate(() => panelGame.level)).toBe(1); expect(await page.evaluate(() => panelGame.paused)).toBe(true);
  await page.getByRole('button',{name:'Play level 2',exact:true}).click();
  await page.getByRole('button',{name:'Sound off',exact:true}).click(); await expect(page.getByRole('button',{name:'Sound on',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Credits',exact:true}).click(); await expect(page.locator('#license')).toContainText('Kevin Ennis');
  await page.keyboard.press('Escape'); expect(await page.evaluate(() => panelGame.paused)).toBe(true);
  const saveKey=await page.evaluate(() => panelGame.saveKey);
  await page.addInitScript(key => { if (location.pathname.includes('/onoff/')) localStorage.setItem(key,'{"level":999999,"deaths":-1}'); }, saveKey);
  await page.reload(); await page.waitForFunction(() => !!window.panelGame); expect(await page.evaluate(() => panelGame.level)).toBe(0);
  console.log('PASS ONOFF: movement, world switching, goal progression, saved level, blur pause, resize, sound toggle, corrupt-save recovery');

  await open('radius-raid'); await page.waitForFunction(() => !!$.hero);
  expect(await page.evaluate(() => $.mute)).toBe(true);
  const playPoint=await page.evaluate(() => ({x:$.cOffset.left+$.buttons[0].x*$.gameScale,y:$.cOffset.top+$.buttons[0].y*$.gameScale}));
  await page.mouse.click(playPoint.x,playPoint.y);
  expect(await page.evaluate(() => $.state)).toBe('play');
  const heroX = await page.evaluate(() => $.hero.x);
  await page.keyboard.down('d'); await page.waitForTimeout(150); await page.keyboard.up('d'); expect(await page.evaluate(() => $.hero.x)).toBeGreaterThan(heroX);
  const c = await page.locator('#cmg').boundingBox();
  await page.mouse.move(c.x+c.width*.8, c.y+c.height*.5); await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
  expect(await page.evaluate(() => $.bulletsFired)).toBeGreaterThan(0);
  // A real enemy death applies the game's score and kill accounting.
  await expect.poll(() => page.evaluate(() => $.enemies.length),{timeout:10000}).toBeGreaterThan(0);
  await page.evaluate(() => { const e=$.enemies[0]; e.receiveDamage(0,e.life); });
  await expect.poll(() => page.evaluate(() => $.score)).toBeGreaterThan(0);
  await page.keyboard.press('p'); expect(await page.evaluate(() => $.state)).toBe('pause');
  const raid = await page.evaluate(() => ({score:$.score,x:$.hero.x,y:$.hero.y,tick:$.tick}));
  await layouts('radius-raid','#cmg'); expect(await page.evaluate(() => ({score:$.score,x:$.hero.x,y:$.hero.y,tick:$.tick}))).toEqual(raid);
  await page.getByRole('button',{name:'Resume',exact:true}).click(); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); expect(await page.evaluate(() => $.state)).toBe('pause');
  expect(await page.evaluate(() => Object.values($.keys.state).every(v => !v))).toBe(true);
  await page.reload(); await page.waitForFunction(() => !!$.hero); expect(await page.evaluate(() => $.storage.score)).toBe(raid.score); expect(await page.evaluate(() => $.state)).toBe('menu');
  await page.getByRole('button',{name:'Credits',exact:true}).click(); await expect(page.locator('#license')).toContainText('GoldFire');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem($.storageKey, 'broken')); await page.reload(); await page.waitForFunction(() => !!$.hero); expect(await page.evaluate(() => $.storage.score)).toBe(0);
  console.log('PASS Radius Raid: movement, firing, enemy score, pause, scaled bounds, saved score, offline sound assets, corrupt-save recovery');
  expect(errors).toEqual([]); expect(failed).toEqual([]); expect(remote).toEqual([]);
  console.log('PASS all games: no runtime errors, missing assets or external requests');
} finally { await browser.close(); }
