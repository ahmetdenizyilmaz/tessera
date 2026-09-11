import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
const capture = JSON.parse(
  "[" +
    readFileSync(process.argv[2], "utf8").trim().split("\n").join(",") +
    "]",
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
try {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: "node_modules/@xterm/xterm/lib/xterm.js" });
  await page.addStyleTag({ path: "node_modules/@xterm/xterm/css/xterm.css" });
  const bundled = await build({
    entryPoints: ["src/lib/terminalCursor.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "TesseraCursor",
  });
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const result = await page.evaluate(async (chunks) => {
    const terminal = new window.Terminal({ cols: 120, rows: 30 });
    terminal.open(document.getElementById("root"));
    terminal.focus();
    const bad = [],
      protectedBad = [];
    let time = 0;
    const guard = window.TesseraCursor.installTerminalCursorGuard(
      terminal,
      () => time > 5000 && time < 25000,
    );
    terminal.onRender(() => {
      const b = terminal.buffer.active;
      const row = b.getLine(b.baseY + b.cursorY)?.translateToString(true) || "";
      if (
        time > 5000 &&
        time < 25000 &&
        document.querySelector(".xterm-cursor") &&
        row.trim() &&
        !row.trimStart().startsWith("›")
      ) {
        const sample = { time, row, x: b.cursorX, y: b.cursorY };
        bad.push(sample);
        if (!terminal.element.classList.contains("terminal-cursor-guarded"))
          protectedBad.push(sample);
      }
    });
    // Recreate Tessera's backend 5ms output batches, with their real timing.
    const batches = [];
    for (const chunk of chunks) {
      if (chunk.ms > 26000) break;
      const last = batches.at(-1);
      if (last && chunk.ms - last.ms <= 5) last.data += chunk.data;
      else batches.push({ ...chunk });
    }
    const start = performance.now();
    for (const chunk of batches) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, chunk.ms - (performance.now() - start)),
        ),
      );
      time = chunk.ms;
      terminal.write(chunk.data);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    guard.dispose();
    terminal.dispose();
    return {
      totalBatches: batches.length,
      badCount: bad.length,
      protectedBadCount: protectedBad.length,
      bad: bad.slice(0, 5),
      protectedBad: protectedBad.slice(0, 5),
    };
  }, capture);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
