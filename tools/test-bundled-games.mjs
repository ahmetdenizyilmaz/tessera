// Gameplay and responsive layouts in Edge. Run with Vite on port 1420.
import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:650,height:780}}),page=await context.newPage();
const errors=[],failed=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)failed.push(`${r.status()} ${r.url()}`);});
async function open(slug){await page.goto(`http://127.0.0.1:1420/examples/html-apps/${slug}/index.html`);await page.waitForFunction(()=>!!(window.panelGame||window.game));}
async function layout(slug,selector){
 for(const [width,height] of [[650,780],[420,600],[280,420],[1100,800]]){
  await page.setViewportSize({width,height});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect.poll(async()=>{const b=await page.locator(selector).boundingBox();return b.x>=0&&b.x+b.width<=width+1&&b.y+b.height<height;}).toBe(true);
 }
 await page.setViewportSize({width:650,height:780});await page.screenshot({path:`.tmp/game-${slug}.png`});
}
try{
 await open('2048');
 await page.evaluate(()=>{game.grid=new Grid(4);game.grid.insertTile(new Tile({x:0,y:0},2));game.grid.insertTile(new Tile({x:1,y:0},2));game.score=0;game.over=game.won=game.keepPlaying=false;game.actuate();});
 await page.keyboard.press('ArrowLeft');expect(await page.evaluate(()=>game.score)).toBe(4);expect(await page.evaluate(()=>game.grid.cells[0][0].value)).toBe(4);
 const board=await page.evaluate(()=>game.serialize());await page.reload();await page.waitForFunction(()=>!!window.game);expect(await page.evaluate(()=>game.serialize())).toEqual(board);
 await layout('2048','.game-container');
 await page.evaluate(()=>localStorage.setItem(game.storageManager.gameStateKey,'{"grid":{}}'));await page.reload();await page.waitForFunction(()=>!!window.game);expect(await page.evaluate(()=>game.grid.availableCells().length)).toBe(14);
 console.log('PASS 2048: keyboard merge, score, reload, corrupt save recovery, four panel sizes');
 await open('tetris');await page.getByRole('button',{name:'Start',exact:true}).click();
 await page.evaluate(()=>{clearBlocks();setCurrentPiece({type:o,dir:0,x:4,y:0});});
 await page.keyboard.press('ArrowLeft');expect(await page.evaluate(()=>current.x)).toBe(3);
 await page.keyboard.press('ArrowUp');expect(await page.evaluate(()=>current.dir)).toBe(1);
 // Complete a bottom row using a real falling square and the public drop button.
 await page.evaluate(()=>{clearBlocks();for(let x=0;x<10;x++)if(x!==4&&x!==5)setBlock(x,19,i);setCurrentPiece({type:o,dir:0,x:4,y:0});});
 await page.getByRole('button',{name:'Drop',exact:true}).click();expect(await page.evaluate(()=>rows)).toBe(1);expect(await page.evaluate(()=>score)).toBe(110);
 await page.keyboard.press('Space');expect(await page.evaluate(()=>panelGame.paused)).toBe(true);
 const tetris=await page.evaluate(()=>JSON.parse(JSON.stringify({blocks,score,rows,current,next})));await page.waitForTimeout(800);expect(await page.evaluate(()=>JSON.parse(JSON.stringify({blocks,score,rows,current,next})))).toEqual(tetris);
 await layout('tetris','#canvas');expect(await page.evaluate(()=>JSON.parse(JSON.stringify({blocks,score,rows,current,next})))).toEqual(tetris);
 await page.reload();await page.waitForFunction(()=>!!window.panelGame);expect(await page.evaluate(()=>JSON.parse(JSON.stringify({blocks,score,rows,current,next})))).toEqual(tetris);expect(await page.evaluate(()=>panelGame.paused)).toBe(true);
 await page.getByRole('button',{name:'Resume',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect(await page.evaluate(()=>panelGame.paused)).toBe(true);
 console.log('PASS Tetris: keyboard movement/rotation, line clear, scoring, pause/blur, reload and resize retain board');
 await open('breakout');await page.getByRole('button',{name:'Start',exact:true}).click();
 expect(await page.evaluate(()=>game.ball.moving)).toBe(true);
 const x=await page.evaluate(()=>game.paddle.x);await page.keyboard.down('ArrowLeft');await page.waitForTimeout(100);await page.keyboard.up('ArrowLeft');expect(await page.evaluate(()=>game.paddle.x)).toBeLessThan(x);
 // Put the ball beneath a bottom-row brick and let collision handling do the hit.
 await page.evaluate(()=>{const brick=game.court.bricks.reduce((a,b)=>a.bottom>b.bottom?a:b);game.ball.setpos((brick.left+brick.right)/2,brick.bottom+game.ball.radius+1);game.ball.setdir(0,-1);});
 await expect.poll(()=>page.evaluate(()=>game.court.numhits)).toBeGreaterThan(0);
 await page.keyboard.press('Space');expect(await page.evaluate(()=>panelGame.paused)).toBe(true);
 expect(await page.evaluate(()=>game.score.score)).toBeGreaterThan(0);
 const snapshot=()=>page.evaluate(()=>({level:game.level,score:game.score.score,lives:game.score.lives,hits:game.court.bricks.map(b=>b.hit),x:game.ball.x,y:game.ball.y,paddle:game.paddle.x}));
 const breakout=await snapshot();await page.waitForTimeout(800);expect(await snapshot()).toEqual(breakout);
 await layout('breakout','#canvas');expect(await snapshot()).toEqual(breakout);
 await page.reload();await page.waitForFunction(()=>!!window.panelGame);expect(await snapshot()).toEqual(breakout);expect(await page.evaluate(()=>panelGame.paused)).toBe(true);
 await page.getByRole('button',{name:'Resume',exact:true}).click();await page.evaluate(()=>game.loseBall());expect(await page.evaluate(()=>game.ball.moving)).toBe(true);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));expect(await page.evaluate(()=>panelGame.paused)).toBe(true);
 await page.getByText('Credits & source',{exact:true}).click();await expect(page.getByText(/Jake Gordon and contributors/)).toBeVisible();
 console.log('PASS Breakout: keyboard paddle, real ball/brick collision, score, pause/blur, reload, resize and next-life launch');
 expect(errors).toEqual([]);expect(failed).toEqual([]);
 console.log('PASS no page errors or missing/remote runtime assets');
}finally{await browser.close();}
