// npm run dev, then node tools/test-codex-startup-ui.mjs [base URL]
// Real React/XTerm and session restart logic; only Tauri IPC is mocked.
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const mode of ["terminal", "error"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", e => {
      // Vite's HMR socket can close while the isolated fixture navigates.
      if (!e.message.includes("WebSocket closed without opened")) errors.push(e.message);
    });
    await page.route("**/codex-startup-test?*", route => route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/panel-ui-fixture.jsx"></script>`,
    }));
    await page.goto(`${process.argv[2] || "http://127.0.0.1:1420"}/codex-startup-test?startup=${mode}`);
    const panel = page.locator("#codex");
    await expect(panel).toContainText("Opening the Codex terminal");
    await expect(panel.getByLabel("Message Codex")).toHaveCount(0);
    await expect(panel.locator(".xterm")).toHaveCount(0);
    await page.evaluate(() => {
      window.chatFlashed = false;
      new MutationObserver(() => {
        if (document.querySelector("#codex .chat-textarea")) window.chatFlashed = true;
      }).observe(document.querySelector("#codex"), { childList: true, subtree: true });
      window.releaseStartup();
    });
    if (mode === "error") {
      await expect(panel.getByRole("alert")).toContainText("fixture failure");
      await expect(panel.getByLabel("Message Codex")).toHaveCount(0);
      await page.evaluate(() => { window.startupError = false; });
      await panel.getByRole("button", { name: "Retry / resume" }).click();
    }
    await expect(panel.locator(".xterm")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.calls.filter(c => c.command === "codex_terminal_spawn").length)).toBe(1);
    expect(await page.evaluate(() => window.instanceStore.getState().instances.get("codex-ui"))).toMatchObject({
      codexThreadId: "thread-fixture", codexHasTurns: false, codexResumable: true,
    });
    await panel.getByTitle("Restart agent (resume conversation)").click();
    await expect.poll(() => page.evaluate(() => window.calls.filter(c => c.command === "codex_terminal_spawn").length)).toBe(2);
    expect(await page.evaluate(() => window.calls.filter(c => c.command === "codex_configure").at(-1).args.threadId)).toBe("thread-fixture");
    expect(await page.evaluate(() => window.calls.filter(c => c.command === "codex_send"))).toEqual([]);
    expect(await page.evaluate(() => window.chatFlashed)).toBe(false);
    expect(errors).toEqual([]);
    console.log(`PASS ${mode}: no chat flash, immediate empty terminal, exact-ID restart, no hidden messages`);
    await page.close();
  }
} finally {
  await browser.close();
}
