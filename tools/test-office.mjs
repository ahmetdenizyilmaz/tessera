// Start Vite, then node tools/test-office.mjs [base URL]. Synthetic sessions only.
import { chromium, expect } from '@playwright/test';
expect.configure({ timeout: 20000 });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(90000);
const errors = [];
page.on('pageerror', error => { if (!error.message.includes('WebSocket closed without opened')) errors.push(error.message); });
page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()?.errorText));
await page.route('**/office-test*', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
<script type="module" src="/tools/office-fixture.jsx"></script>` }));
const url = `${process.argv[2] || 'http://127.0.0.1:1420'}/office-test`;
async function clickTile(x, y) {
  const point = await page.evaluate(({ x, y }) => {
    const rect = document.querySelector('.office-canvas').getBoundingClientRect(), layout = window.office.getState().layout;
    const sx = (layout.width + layout.height) * 32, sy = sx / 2;
    const zoom = Math.max(.25, Math.min(1.25, (rect.width - 90) / sx, (rect.height - 100) / sy));
    const cx = rect.width / 2 - (layout.width - layout.height) * 16 * zoom, cy = (rect.height - sy * zoom) / 2 + 18;
    return { x: rect.x + cx + (x - y) * 32 * zoom, y: rect.y + cy + (x + y + 1) * 16 * zoom };
  }, { x, y });
  await page.mouse.click(point.x, point.y);
}
async function clickWorker(id) {
  // The real character hit area, projected with the fitted camera after resize.
  await expect.poll(() => page.evaluate(id => { const w = window.office.getState().workers[id]; return w.position.x === w.targetPosition.gridX && w.position.y === w.targetPosition.gridY; }, id), { timeout: 20000 }).toBe(true);
  await page.getByRole('button', { name: 'Fit office', exact: true }).click();
  const point = await page.evaluate(id => {
    const rect = document.querySelector('.office-canvas').getBoundingClientRect(), { layout, workers } = window.office.getState();
    const { x, y } = workers[id].position;
    const sx = (layout.width + layout.height) * 32, sy = sx / 2;
    const zoom = Math.max(.25, Math.min(1.25, (rect.width - 90) / sx, (rect.height - 100) / sy));
    return { x: rect.x + rect.width / 2 - (layout.width - layout.height) * 16 * zoom + (x - y) * 32 * zoom,
      y: rect.y + (rect.height - sy * zoom) / 2 + 18 + ((x + y + 1) * 16 - 25) * zoom };
  }, id);
  await page.mouse.click(point.x, point.y);
}
async function clickOffice() {
  const r = await page.locator('.office-canvas').boundingBox();
  await page.mouse.click(r.x + 20, r.y + 20);
}
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.office-canvas canvas')).toHaveCount(1, { timeout: 60000 });
  await expect(page.locator('[data-office-agent]')).toHaveCount(5);
  await expect(page.getByTestId('office-balance')).toHaveText('270');
  await expect(page.locator('[data-office-agent="tester"]')).toContainText('Running command');
  await expect(page.locator('[data-office-agent="reviewer"]')).toContainText('Waiting for approval');
  await expect.poll(() => page.evaluate(() => Object.values(window.office.getState().workers).every(w => w.position.x === w.targetPosition.gridX && w.position.y === w.targetPosition.gridY)), { timeout: 20000 }).toBe(true);
  await page.screenshot({ path: '../tessera-office-validation/office.png' });
  await page.locator('[data-office-agent="tester"]').click();
  await expect(page.getByRole('complementary', { name: 'Chat with Test engineer' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agent conversation' })).toContainText('Run the regression suite');
  await expect(page.locator('.office-chat-messages')).toContainText('npm test');
  await expect(page.getByRole('button', { name: 'Show office team' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-office-agent]')).toHaveCount(0);
  await page.evaluate(() => { const s = window.codex.getState().sessions.tester; window.codex.getState().receive({ id: 'tester', generation: 'fixture', sequence: s.sequence + 1, message: { method: 'item/started', params: { threadId: 'tester', item: { id: 'answer', type: 'agentMessage', text: 'The regression suite passes. I am checking the reconnect path next.' } } } }); });
  await expect(page.locator('.office-chat-messages')).toContainText('The regression suite passes.');
  await page.screenshot({ path: '../tessera-office-validation/office-chat.png', animations: 'disabled' });
  await clickWorker('architect');
  await expect(page.getByRole('complementary', { name: 'Chat with Backend architect' })).toBeVisible();
  await expect(page.locator('.office-chat-messages')).toContainText('Refactor the connection manager');
  await expect(page.locator('.office-chat-messages')).not.toContainText('regression suite');
  const canvas = await page.locator('.office-canvas').boundingBox();
  await page.mouse.move(canvas.x + 20, canvas.y + 20); await page.mouse.down();
  await page.mouse.move(canvas.x + 70, canvas.y + 60, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.office-chat')).toBeVisible();
  await clickOffice();
  await expect(page.locator('.office-chat')).toHaveCount(0);
  await expect(page.locator('[data-office-agent]')).toHaveCount(5);
  await clickWorker('tester');
  await expect(page.locator('.office-chat')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.office-chat')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.officeCalls.filter(c => !['activity_list', 'session_load_history', 'codex_read_thread', 'opencode_snapshot'].includes(c.command)))).toEqual([]);
  console.log('PASS live named characters, providers, task stations, completed-turn rewards, and StrictMode initialization');
  console.log('PASS real character clicks, live Codex/Claude transcripts, collapsed roster, switching, floor/Escape dismissal, and panning without dismissal or provider side effects');

  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await page.getByRole('button', { name: 'Buy Desk-side plant', exact: true }).click();
  await expect(page.getByTestId('office-balance')).toHaveText('240');
  await page.screenshot({ path: '../tessera-office-validation/shop.png' });
  await page.getByRole('button', { name: 'Place Desk-side plant', exact: true }).click();
  const originalFurniture = await page.evaluate(() => window.office.getState().layout.furniture.length);
  await clickTile(19, 6);
  await expect.poll(() => page.evaluate(() => window.office.getState().layout.furniture.length)).toBe(originalFurniture + 1);
  await clickTile(20, 6);
  await expect.poll(() => page.evaluate(() => window.office.getState().layout.furniture.length)).toBe(originalFurniture + 1);
  await page.getByRole('button', { name: 'Store', exact: true }).click();
  await clickTile(19, 6);
  await expect.poll(() => page.evaluate(() => window.office.getState().inventory['shop-plant-small'])).toBe(1);
  await expect.poll(() => page.evaluate(() => window.office.getState().layout.furniture.length)).toBe(originalFurniture);
  await page.getByRole('button', { name: 'Finish decorating' }).click();
  await clickTile(0, 0);
  await expect.poll(() => page.evaluate(() => window.office.getState().layout.furniture.length)).toBe(originalFurniture);
  console.log('PASS shop debit, actual canvas placement, no free duplicates, packing, and inactive edit controls');

  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await page.getByRole('button', { name: 'Wearables', exact: true }).click();
  await page.getByRole('button', { name: 'Buy Studio headphones' }).click();
  await page.getByRole('button', { name: 'Close shop' }).click();
  await page.locator('[data-office-agent="tester"]').click();
  await page.locator('.office-chat-profile summary').click();
  await page.getByRole('combobox', { name: 'Accessory for Test engineer' }).selectOption('headphones');
  await expect.poll(() => page.evaluate(() => window.office.getState().profiles.tester.accessory)).toBe('headphones');
  await page.getByRole('button', { name: 'Back to panels' }).click();
  await page.evaluate(() => { window.officeRecords.push({ ...window.officeRecords[0], id: 'while-away', updatedAt: Date.now() }); });
  await expect.poll(() => page.evaluate(() => window.office.getState().currency), { timeout: 10000 }).toBe(205);
  await page.getByRole('button', { name: 'Return to office' }).click();
  await expect(page.locator('.office-canvas canvas')).toHaveCount(1);
  await expect(page.getByTestId('office-balance')).toHaveText('205');
  await page.reload();
  await expect(page.getByTestId('office-balance')).toHaveText('205');
  await expect.poll(() => page.evaluate(() => window.office.getState().profiles.tester.accessory)).toBe('headphones');
  await expect.poll(() => page.evaluate(() => window.office.getState().inventory['shop-plant-small'])).toBe(1);
  console.log('PASS accessories, rewards outside office, repeat opening, and persisted balance/inventory without duplicate rewards');

  await page.evaluate(() => { const s = window.codex.getState().sessions.tester; window.codex.getState().receive({ id: 'tester', generation: 'fixture', sequence: s.sequence + 1, message: { method: 'turn/completed', params: { threadId: 'tester', turn: { id: 'new-turn', status: 'completed' } } } }); });
  await expect(page.locator('[data-office-agent="tester"]')).toContainText('Taking a break');
  await page.evaluate(() => { window.officeFail = true; });
  await expect(page.getByRole('alert')).toContainText('catch up', { timeout: 10000 });
  await page.evaluate(() => { window.officeFail = false; });
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 10000 });
  await page.evaluate(() => {
    const base = window.officeRecords[0];
    const rows = Array.from({ length: 520 }, (_, i) => ({ ...base, id: `page-${String(i).padStart(4, '0')}`, startedAt: base.startedAt + 100, updatedAt: Date.now() }));
    window.officeRecords.push(...rows);
    window.office.setState({ pendingRecords: ['done-a'] });
  });
  await expect.poll(() => page.evaluate(() => window.office.getState().completedTasks), { timeout: 12000 }).toBe(524);
  await expect(page.getByTestId('office-balance')).toHaveText('23,605');
  console.log('PASS native reward pagination with equal timestamps and appended old records');
  await page.setViewportSize({ width: 600, height: 850 });
  await expect(page.getByRole('button', { name: 'Shop', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.locator('[data-office-agent="tester"]').click();
  await expect(page.getByRole('region', { name: 'Agent conversation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close agent chat' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: '../tessera-office-validation/office-chat-narrow.png', animations: 'disabled' });
  await clickOffice();
  await expect(page.locator('.office-chat')).toHaveCount(0);
  await page.setViewportSize({ width: 1500, height: 1000 });

  await page.evaluate(() => {
    const base = window.instances.getState().instances.get('architect');
    const extras = [
      { ...base, id: 'terminal', name: 'Terminal Claude', claudeSessionId: 'terminal-history', config: { ...base.config, panelView: 'terminal' } },
      { ...base, id: 'saved', name: 'Saved Codex', codexThreadId: 'saved-codex', config: { ...base.config, agentProvider: 'codex' } },
      { ...base, id: 'api', name: 'API writer', config: { ...base.config, llmConfig: { provider: 'openai', model: 'API fixture' } } },
      { ...base, id: 'automation', name: 'OpenCode builder', config: { ...base.config, agentProvider: 'opencode' } },
    ];
    window.instances.setState(s => ({ instances: new Map([...s.instances, ...extras.map(i => [i.id, i])]) }));
    window.officeHistory['terminal-history'] = [{ role: 'user', content: 'Please inspect the terminal project.' }, { role: 'assistant', content: 'I found the terminal transcript.' }];
    window.llm.getState().addUserMessage('api', 'Draft a project update.');
    window.llm.getState().startStreaming('api');
    window.llm.getState().appendChunk('api', 'API conversation is live.');
    window.opencode.setState({ sessions: { automation: { generation: 'oc', sessionId: 'oc-session', connected: true, status: { type: 'busy' }, messages: [{ info: { id: 'oc-answer', role: 'assistant' }, parts: [{ id: 'text', type: 'text', text: 'OpenCode is building the project.' }] }], permissions: [], questions: [] } } });
  });
  await page.locator('[data-office-agent="terminal"]').click();
  await expect(page.locator('.office-chat-messages')).toContainText('I found the terminal transcript.');
  await page.evaluate(() => { window.officeHistory['terminal-history'].push({ role: 'assistant', content: 'A newly saved terminal answer.' }); });
  await expect(page.locator('.office-chat-messages')).toContainText('A newly saved terminal answer.');
  await page.evaluate(() => { window.officeHistoryFail = true; });
  await expect(page.locator('.office-chat-error')).toContainText('temporarily unavailable');
  await expect(page.locator('.office-chat-messages')).toContainText('I found the terminal transcript.');
  await page.evaluate(() => { window.officeHistoryFail = false; });
  await expect(page.locator('.office-chat-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show office team' }).click();
  await page.locator('[data-office-agent="saved"]').click();
  await expect(page.locator('.office-chat-messages')).toContainText('Saved Codex thread restored in office.');
  await page.getByRole('button', { name: 'Close agent chat' }).click();
  await page.locator('[data-office-agent="automation"]').click();
  await expect(page.locator('.office-chat-messages')).toContainText('OpenCode is building the project.');
  await page.getByRole('button', { name: 'Close agent chat' }).click();
  await page.locator('[data-office-agent="api"]').click();
  await expect(page.locator('.office-chat-heading')).toContainText('OpenAI');
  await expect(page.locator('.office-chat-messages')).toContainText('API conversation is live.');
  await page.evaluate(() => { window.llm.getState().appendChunk('api', '\n\n' + 'More live output.\n\n'.repeat(70)); });
  await expect.poll(() => page.locator('.office-chat-messages').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(65);
  await page.locator('.office-chat-messages').evaluate(el => { el.scrollTop = 0; });
  await expect(page.getByRole('button', { name: 'Latest messages' })).toBeVisible();
  await page.evaluate(() => { window.llm.getState().appendChunk('api', 'Final live chunk.'); });
  await expect(page.locator('.office-chat-messages')).toContainText('Final live chunk.');
  expect(await page.locator('.office-chat-messages').evaluate(el => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Latest messages' }).click();
  await expect.poll(() => page.locator('.office-chat-messages').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(65);
  await page.getByRole('button', { name: 'Close agent chat' }).click();
  await page.evaluate(() => { window.officeHistoryDelay = 1500; });
  await page.locator('[data-office-agent="terminal"]').click();
  await expect(page.locator('.office-chat-messages')).toContainText('Loading conversation');
  await clickWorker('architect');
  await expect(page.locator('.office-chat-messages')).toContainText('Refactor the connection manager');
  // Wait for the previous request to resolve: it must not overwrite this chat.
  await expect.poll(() => page.evaluate(() => window.officeCalls.filter(c => c.command === 'activity_list').length), { timeout: 7000 }).toBeGreaterThan(await page.evaluate(() => window.officeCalls.filter(c => c.command === 'activity_list').length));
  await expect(page.locator('.office-chat-messages')).not.toContainText('terminal transcript');
  await page.evaluate(() => { window.instances.setState(s => { const instances = new Map(s.instances); instances.delete('architect'); return { instances }; }); });
  await expect(page.locator('.office-chat')).toHaveCount(0);
  await expect(page.locator('.office-team--collapsed')).toHaveCount(0);
  expect(await page.evaluate(() => window.officeCalls.filter(c => !['activity_list', 'session_load_history', 'codex_read_thread', 'opencode_snapshot'].includes(c.command)))).toEqual([]);
  await page.locator('[data-office-agent="tester"]').click();
  await page.getByRole('button', { name: 'Open full chat' }).click();
  await expect(page.getByRole('button', { name: 'Return to office' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to office' }).click();
  await expect(page.locator('.office-chat')).toHaveCount(0);
  console.log('PASS terminal history polling/recovery, saved Codex, OpenCode, API streaming, scroll retention, stale read isolation, removed agents, full chat navigation, and narrow chat');
  await page.goto(`${url}?empty`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Your team starts here')).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS completion movement, connection recovery, narrow view, and empty office');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error((await page.locator('body').innerText()).slice(0, 3000));
  await page.screenshot({ path: '../tessera-office-validation/failure.png' });
  throw error;
} finally { await browser.close(); }
