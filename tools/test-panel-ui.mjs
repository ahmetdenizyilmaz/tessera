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
      window.codexStore.getState().receive({
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
  await page.setViewportSize({ width: 1200, height: 800 });
  const missingThread = async () =>
    page.evaluate(() => {
      window.instanceStore.getState().updateInstance("codex-ui", {
        codexThreadId: "missing-thread",
        codexHasTurns: true,
      });
      const store = window.codexStore;
      store.setState((state) => ({
        sessions: {
          ...state.sessions,
          "codex-ui": {
            ...state.sessions["codex-ui"],
            connected: false,
            error: "no rollout found for thread id missing-thread",
          },
        },
      }));
    });
  await missingThread();
  await expect(codex.getByRole("alert")).toContainText(
    "This saved conversation has no transcript",
  );
  const countBefore = await page.evaluate(
    () =>
      window.calls.filter((call) => call.command === "codex_configure").length,
  );
  await codex
    .getByRole("button", { name: "Find saved conversation", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === "codex_configure")
          .length,
    ),
  ).toBe(countBefore);
  await codex.getByRole("button", { name: /Saved conversation C:/ }).click();
  await expect(codex.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === "codex_configure").at(-1)
          .args.threadId,
    ),
  ).toBe("recoverable-thread");
  await missingThread();
  await codex
    .getByRole("button", { name: "Start a new conversation", exact: true })
    .click();
  await expect(codex.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === "codex_configure").at(-1)
          .args.threadId,
    ),
  ).toBeNull();
  console.log(
    "PASS missing transcript keeps its ID until explicit recovery; history resumes and empty restart reconnects",
  );

  // Settings defaults affect new panels, while existing conversations preserve
  // their own permissions until explicitly changed from the panel menu.
  await page.evaluate(() => window.showPermissionSettings());
  const defaults = page.getByLabel("Default Codex permissions", { exact: true });
  await expect(defaults).toHaveValue("workspace-write");
  await defaults.selectOption("auto-review");
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tessera-settings")).state.settings.defaultCodexPermissionMode,
  )).toBe("auto-review");
  expect(await page.evaluate(() => window.settingsStore.getState().settings.defaultPermissionMode)).toBe("auto");
  expect(await page.evaluate(() => window.instanceStore.getState().instances.get("codex-ui").config.codex.approvalsReviewer)).toBeUndefined();

  for (const panelView of ["chat", "terminal"]) {
    await page.evaluate((view) => window.showCodexSetup(view), panelView);
    const setup = page.locator(`#permission-setup-${panelView}`);
    await expect(setup.getByLabel("Codex permissions", { exact: true })).toHaveValue("auto-review");
    await setup.getByRole("button", { name: "Add Codex panel", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.calls.filter(c => c.command === "codex_configure").at(-1)?.args.config.terminal)).toBe(panelView === "terminal");
    const call = await page.evaluate(() => window.calls.filter(c => c.command === "codex_configure").at(-1).args);
    expect(call.config).toMatchObject({ sandbox: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "auto_review" });
    expect(await page.evaluate(id => window.instanceStore.getState().instances.get(id).config.codex.approvalsReviewer, call.id)).toBe("auto_review");
  }

  await page.evaluate(() => {
    window.instanceStore.getState().updateInstance("codex-ui", { codexThreadId: "keep-conversation", codexHasTurns: true });
  });
  await codex.getByTitle("Panel controls").click();
  const panelPermissions = codex.getByLabel("Codex permissions", { exact: true });
  await expect(panelPermissions).toHaveValue("workspace-write");
  await panelPermissions.selectOption("auto-review");
  await expect.poll(() => page.evaluate(() => window.calls.filter(c => c.command === "codex_configure").at(-1).args.threadId)).toBe("keep-conversation");
  expect(await page.evaluate(() => window.calls.filter(c => c.command === "codex_configure").at(-1).args.config.approvalsReviewer)).toBe("auto_review");
  await page.evaluate(() => window.codexStore.setState(s => ({ sessions: { ...s.sessions, "codex-ui": { ...s.sessions["codex-ui"], busy: true } } })));
  await expect(panelPermissions).toBeDisabled();
  await page.evaluate(() => window.codexStore.setState(s => ({ sessions: { ...s.sessions, "codex-ui": { ...s.sessions["codex-ui"], busy: false } } })));
  await panelPermissions.selectOption("danger-full-access");
  await expect.poll(() => page.evaluate(() => window.calls.filter(c => c.command === "codex_configure").at(-1).args.config.approvalPolicy)).toBe("never");
  expect(await page.evaluate(() => window.settingsStore.getState().settings.defaultCodexPermissionMode)).toBe("auto-review");
  expect(errors).toEqual([]);
  console.log("PASS persisted Codex default, chat/terminal creation, independent Claude settings and thread-preserving permission changes");

  await codex.getByTitle("Panel controls").click();
  await codex.getByLabel("Message Codex").fill("keep this unsent draft");
  await page.evaluate(() => window.codexStore.setState(s => ({ sessions: { ...s.sessions,
    "codex-ui": { ...s.sessions["codex-ui"], busy: true, requests: [{ id: 81,
      method: "item/tool/requestUserInput", params: { questions: [{ id: "choice", header: "Approach",
        question: "Which approach should Codex use?", options: [
          { label: "Small change", description: "Keep the existing behavior." },
          { label: "Larger change", description: "Replace the implementation." },
        ] }]} }] },
  }})));
  const question = codex.getByLabel("Codex request");
  await expect(question).toContainText("Keep the existing behavior.");
  await expect(codex.getByLabel("Message Codex")).toBeFocused();
  await codex.getByLabel("Message Codex").press("Alt+ArrowUp");
  await expect(question).toBeFocused();
  await expect(codex.locator(".codex-requests--expanded")).toBeVisible();
  await question.getByRole("button", { name: /Small change/ }).click();
  await expect(question.getByRole("button", { name: /Small change/ })).toHaveAttribute("aria-pressed", "true");
  await question.getByLabel("Which approach should Codex use?").fill("custom answer");
  await question.getByLabel("Which approach should Codex use?").press("Escape");
  await expect(codex.getByLabel("Message Codex")).toBeFocused();
  await expect(codex.getByLabel("Message Codex")).toHaveValue("keep this unsent draft");
  await codex.getByLabel("Message Codex").press("Alt+ArrowUp");
  await expect(question.getByLabel("Which approach should Codex use?")).toHaveValue("custom answer");
  await question.getByRole("button", { name: "Submit answers" }).click();
  expect(await page.evaluate(() => window.calls.filter(c => c.command === "codex_respond").at(-1)?.args))
    .toEqual({ id: "codex-ui", requestId: 81, response: { answers: { choice: { answers: ["custom answer"] } } } });

  // The shortcut must be caught before xterm turns Alt+Up into PTY bytes.
  await page.evaluate(() => {
    const inst = window.instanceStore.getState().instances.get("codex-ui");
    window.instanceStore.getState().updateInstance("codex-ui", { config: { ...inst.config, panelView: "terminal" } });
    window.codexStore.setState(s => ({ sessions: { ...s.sessions, "codex-ui": {
      ...s.sessions["codex-ui"], materialized: true, requests: [{ id: 82,
        method: "item/commandExecution/requestApproval", params: { command: "echo test\n".repeat(80), availableDecisions: ["accept", "cancel"] },
      }],
    }}}));
  });
  const nativeInput = codex.locator(".xterm-helper-textarea");
  await nativeInput.focus();
  await page.evaluate(() => { window.calls = []; });
  await nativeInput.press("Alt+ArrowUp");
  await expect(question).toBeFocused();
  expect(await page.evaluate(() => window.calls.filter(c => c.command === "pty_write"))).toEqual([]);
  await expect(question.getByRole("button", { name: "Allow once" })).toBeVisible();
  await question.press("Alt+ArrowDown");
  await expect(nativeInput).toBeFocused();
  expect(await page.evaluate(() => window.calls.filter(c => c.command === "codex_respond"))).toEqual([]);
  expect(errors).toEqual([]);
  console.log("PASS Codex questions share Claude styling; Alt+Up/Alt+Down reveal requests without sending terminal keys or answering prompts");

  await page.evaluate(() => {
    window.codexStore.setState(s => ({ sessions: { ...s.sessions, "codex-ui": {
      ...s.sessions["codex-ui"], busy: false, requests: [],
    }}}));
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { readText: async () => "clipboard draft", writeText: async () => {} },
    });
  });
  await expect(question).toHaveCount(0);
  await page.evaluate(() => window.writeTerminalOutput(
    Array.from({ length: 300 }, (_, i) => `history row ${i}`).join("\r\n") + "\r\nPROMPT> ",
  ));
  const promptVisible = () => codex.locator(".xterm-rows").textContent().then(text => text.includes("PROMPT>"));
  const browseHistory = async () => {
    await codex.locator(".xterm").hover();
    await page.mouse.wheel(0, -500);
    await expect.poll(promptVisible).toBe(false);
    await nativeInput.focus();
    await page.evaluate(() => { window.calls = []; });
  };
  const sentKeys = () => page.evaluate(() => window.calls.filter(c => c.command === "pty_write").map(c => c.args.data).join(""));
  await expect.poll(promptVisible).toBe(true);
  await browseHistory();
  await nativeInput.pressSequentially("editable draft");
  await expect.poll(promptVisible).toBe(true);
  await nativeInput.press("Enter");
  await expect.poll(sentKeys).toBe("editable draft\r");
  for (const shortcut of ["Control+V", "Control+Shift+V", "Shift+Insert"]) {
    await browseHistory();
    await nativeInput.press(shortcut);
    await expect.poll(promptVisible).toBe(true);
    await expect.poll(sentKeys).toBe("clipboard draft");
  }
  await browseHistory();
  await codex.locator(".xterm").click({ button: "right" });
  await expect.poll(promptVisible).toBe(true);
  await expect.poll(sentKeys).toBe("clipboard draft");
  await browseHistory();
  await nativeInput.evaluate(node => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "native paste\nsecond line");
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect.poll(promptVisible).toBe(true);
  await expect.poll(sentKeys).toBe("native paste\nsecond line");
  expect(errors).toEqual([]);
  console.log("PASS native panel typing/Enter and all paste paths reveal input from history and send exactly once");
} finally {
  if (errors.length) {
    console.error(errors);
    console.error(
      await page.evaluate(() => window.calls?.map((call) => call.command)),
    );
  }
  await browser.close();
}
