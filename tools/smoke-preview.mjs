// Opt-in live UI regression test against an already running PREVIEW WebView2.
// Usage: node tools/smoke-preview.mjs http://127.0.0.1:9222 C:\path\to\scratch-project
// Launch preview with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
// This creates and closes two test panels and consumes three small Codex turns.
import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

const [endpoint, project] = process.argv.slice(2);
if (!endpoint || !project)
  throw new Error(
    "Provide the preview CDP endpoint and a scratch project folder.",
  );
const browser = await chromium.connectOverCDP(endpoint);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes("tauri.localhost"));
if (!page) throw new Error("No Tessera WebView found.");
const appName = await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("plugin:app|name"),
);
if (appName !== "Tessera Preview") {
  await browser.close();
  throw new Error("Only Tessera Preview may be used for this test.");
}
page.setDefaultTimeout(20000);
const suffix = randomUUID().slice(0, 8);
const names = [`Smoke Chat ${suffix}`, `Smoke Terminal ${suffix}`];
const panel = (name) =>
  page
    .locator(".codex-panel")
    .filter({ has: page.getByText(name, { exact: true }) });

async function create(view, name) {
  await page.getByTitle("New session", { exact: true }).click();
  await page.locator(".panel-view-option").filter({ hasText: view }).click();
  await page.locator(".nsw-tile").filter({ hasText: "Codex" }).click();
  await page.getByText("Existing Codex login ready").waitFor();
  await page.getByLabel("Codex project folder").fill(project);
  const models = page.getByLabel("Codex setup model");
  if (await models.locator('option[value="gpt-5.6-luna"]').count())
    await models.selectOption("gpt-5.6-luna");
  await page
    .locator(".codex-panel")
    .evaluateAll((elements) =>
      elements.forEach((e) => e.setAttribute("data-smoke-existing", "true")),
    );
  await page
    .getByRole("button", { name: "Add Codex panel", exact: true })
    .click();
  const fresh = page.locator(".codex-panel:not([data-smoke-existing])");
  await fresh.waitFor();
  await fresh.getByTitle("Double-click to rename").dblclick();
  await fresh.getByLabel("Panel name").fill(name);
  await fresh.getByLabel("Panel name").press("Enter");
  return panel(name);
}
async function send(target, message) {
  await target.getByLabel("Message Codex").fill(message);
  await target.getByRole("button", { name: "Send", exact: true }).click();
}

try {
  const chat = await create("Chat", names[0]);
  await send(chat, "Reply exactly TESSERA_CHAT_SMOKE_OK. Do not use tools.");
  await expect(chat.locator(".agent-panel-status")).toHaveText("Ready", {
    timeout: 60000,
  });
  await expect(
    chat.locator(".codex-message:not(.codex-message-user)").last(),
  ).toContainText("TESSERA_CHAT_SMOKE_OK");
  console.log("PASS: streamed chat response");

  const terminal = await create("Terminal", names[1]);
  await expect(terminal.locator(".xterm")).toBeVisible();
  await expect(terminal.getByLabel("Message Codex")).toHaveCount(0);
  await expect(terminal.locator(".codex-terminal")).toContainText("OpenAI Codex", { timeout: 30000 });
  await expect(terminal.locator(".codex-terminal")).not.toContainText("Resuming session", { timeout: 30000 });
  const typing = terminal.locator(".xterm-helper-textarea");
  await typing.focus();
  await typing.pressSequentially("Reply exactly TESSERA_TERMINAL_SMOKE_OK. Do not use tools.", { delay: 2 });
  await new Promise(resolve => setTimeout(resolve, 600));
  await typing.press("Enter");
  await expect(terminal.locator(".codex-terminal")).toContainText(
    "TESSERA_TERMINAL_SMOKE_OK",
    { timeout: 60000 },
  );
  await expect(terminal.locator(".agent-panel-status")).toHaveText("Ready", {
    timeout: 60000,
  });
  await expect(terminal.locator(".codex-terminal")).not.toContainText(
    "Permission overrides are not supported",
  );
  console.log("PASS: native terminal attaches before the first user turn");

  await typing.focus();
  await typing.pressSequentially(
    "Reply exactly TESSERA_NATIVE_SECOND_OK. Do not use tools.",
    { delay: 2 },
  );
  // Codex treats rapid keystrokes as a paste burst; wait for its paste debounce
  // so Enter submits instead of becoming a newline in that burst.
  await new Promise((resolve) => setTimeout(resolve, 600));
  await typing.press("Enter");
  await expect
    .poll(
      async () =>
        page.evaluate(async (name) => {
          const saved = JSON.parse(localStorage.getItem("tessera-autosave"));
          const instance = saved.instances.find((i) => i.name === name);
          if (!instance?.codexThreadId) return false;
          const data = await window.__TAURI_INTERNALS__.invoke(
            "codex_read_thread",
            { threadId: instance.codexThreadId },
          );
          const turns = data.thread.turns ?? [];
          return (
            turns.length >= 2 &&
            turns.at(-1).status === "completed" &&
            turns
              .at(-1)
              .items.some(
                (i) =>
                  i.type === "agentMessage" &&
                  i.text?.includes("TESSERA_NATIVE_SECOND_OK"),
              )
          );
        }, names[1]),
      { timeout: 60000 },
    )
    .toBe(true);
  console.log("PASS: native terminal second turn persisted on the same thread");
} finally {
  for (const name of names) {
    const owned = panel(name);
    if (await owned.count())
      await owned
        .getByTitle("Close instance", { exact: true })
        .evaluate((button) => button.click());
  }
  await browser.close();
}
