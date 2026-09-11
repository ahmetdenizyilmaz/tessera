// npm run dev, then node tools/test-panel-ui.mjs [http://127.0.0.1:1420]
// Uses real React components with mocked IPC. No CLI turns or saved workspaces.
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (error) => {
  if (!error.message.includes("WebSocket closed without opened"))
    errors.push(error.stack || error.message);
});
await page.route("**/panel-ui-test", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `<div id="root"></div>
<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
<script type="module" src="/tools/panel-ui-fixture.jsx"></script>`,
  }),
);
try {
  await page.goto(
    `${process.argv[2] || "http://127.0.0.1:1420"}/panel-ui-test`,
  );
  const codex = page.locator("#codex");
  const claude = page.locator("#claude");
  await expect(codex.getByLabel("Message Codex")).toBeEnabled();
  await expect(codex.locator(".agent-panel-metadata")).toContainText("medium");
  await expect(
    codex.getByRole("button", { name: "History", exact: true }),
  ).toHaveCount(0);
  await expect(
    codex.getByRole("button", { name: "New", exact: true }),
  ).toHaveCount(0);
  const headers = await page
    .locator(".agent-panel-toolbar")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        height: node.getBoundingClientRect().height,
        color: getComputedStyle(node).backgroundColor,
      })),
    );
  expect(headers[0]).toEqual(headers[1]);
  await codex.getByTitle("Double-click to rename").dblclick();
  await codex.getByLabel("Panel name").fill("Renamed session");
  await codex.getByLabel("Panel name").press("Enter");
  await expect(codex.getByTitle("Double-click to rename")).toHaveText(
    "Renamed session",
  );
  await codex.getByTitle("Double-click to rename").dblclick();
  await codex.getByLabel("Panel name").fill("Cancelled");
  await codex.getByLabel("Panel name").press("Escape");
  await expect(codex.getByTitle("Double-click to rename")).toHaveText(
    "Renamed session",
  );
  await codex.getByLabel("Panel color").click();
  await expect(page.locator(".color-picker-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await codex.getByTitle("Panel controls").click();
  await codex.getByLabel("Reasoning effort").selectOption("high");
  await expect(codex.locator(".agent-panel-metadata")).toContainText("high");
  await codex.getByLabel("Message Codex").click();
  console.log(
    "PASS shared header, rename/cancel, Claude color chooser and compact model controls",
  );

  for (const target of [codex, claude]) {
    await target.getByLabel("Attach images").click();
    await expect(target.locator(".image-chip")).toHaveCount(1);
  }
  await expect(codex.getByLabel("Send", { exact: true })).toBeEnabled();
  await codex.getByLabel("Send", { exact: true }).click();
  await expect(codex.locator(".image-chip")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.calls.find((call) => call.command === "codex_send").args
          .images[0],
    ),
  ).toMatch(/^data:image\/png;base64,/);
  await claude.getByTitle("Send (Enter)").click();
  expect(
    await page.evaluate(
      () =>
        window.calls.find((call) => call.command === "claude-send").args.images,
    ),
  ).toHaveLength(1);
  await page.evaluate(() => {
    window.pick = null;
  });
  await codex.getByLabel("Attach images").click();
  await expect(codex.locator(".image-chip")).toHaveCount(0);
  await page.evaluate(() => {
    window.pick = ["C:\\images\\missing.png"];
    window.imageError = true;
  });
  await codex.getByLabel("Attach images").click();
  await expect(codex.getByRole("alert")).toContainText("Cannot read image");
  await page.evaluate(() => {
    window.imageError = false;
  });
  await codex.getByLabel("Attach images").click();
  await expect(codex.locator(".image-chip")).toHaveCount(1);
  await expect(codex.getByRole("alert")).toHaveCount(0);
  console.log(
    "PASS native picker wiring, previews, image-only send, cancel and recoverable errors for both providers",
  );

  const input = codex.getByLabel("Message Codex");
  await input.fill("Keep my draft");
  await input.evaluate((node) => node.setSelectionRange(4, 4));
  await page.evaluate(() => {
    for (let sequence = 1; sequence <= 20; sequence++)
      window.codexStore
        .getState()
        .receive({
          id: "codex-ui",
          generation: "fixture",
          sequence,
          message: {
            method: "item/reasoning/summaryTextDelta",
            params: {
              threadId: "thread-fixture",
              itemId: "thinking",
              delta: " reasoning",
            },
          },
        });
  });
  await expect(input).toBeFocused();
  expect(await input.evaluate((node) => node.selectionStart)).toBe(4);
  await page.setViewportSize({ width: 620, height: 800 });
  await expect(codex.getByTitle("Close instance")).toBeVisible();
  await expect(codex.getByTitle("Panel controls")).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PASS draft focus during streamed thinking and narrow-panel controls",
  );
} finally {
  if (errors.length) {
    console.error(errors);
    console.error(
      await page.evaluate(() => window.calls?.map((call) => call.command)),
    );
  }
  await browser.close();
}
