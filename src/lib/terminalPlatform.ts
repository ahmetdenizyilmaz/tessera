import { invoke } from "@tauri-apps/api/core";
import type { ITerminalOptions } from "@xterm/xterm";

type PtyCapabilities = Pick<ITerminalOptions, "windowsPty">;
let capabilities: Promise<PtyCapabilities> | undefined;

/** The PTY host determines terminal compatibility, not the webview user agent. */
export function terminalPlatform(): Promise<PtyCapabilities> {
  return capabilities ??= invoke<PtyCapabilities | null>("pty_capabilities")
    .then(value => value ?? {})
    .catch(error => {
      capabilities = undefined;
      throw error;
    });
}
