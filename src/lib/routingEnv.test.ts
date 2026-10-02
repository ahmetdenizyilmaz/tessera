import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { buildRoutingEnv } from "./routingEnv";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invoked = vi.mocked(invoke);

beforeEach(() => {
  invoked.mockReset();
  invoked.mockImplementation(async (cmd: string) => {
    if (cmd === "llm_get_api_key") return "sk-or-test";
    if (cmd === "claude_routed_config_dir") return "C:/Users/ady/.tessera/claude-config/openrouter";
    return null;
  });
});

it("leaves an unrouted panel's environment alone", async () => {
  expect(await buildRoutingEnv(undefined, "C:/project")).toBeNull();
  expect(await buildRoutingEnv({ gateway: "anthropic" }, "C:/project")).toBeNull();
  expect(invoked).not.toHaveBeenCalled();
});

it("gives a routed panel its own config home so /model stays out of ~/.claude", async () => {
  const env = await buildRoutingEnv(
    { gateway: "openrouter", model: "openrouter/free" },
    "C:/project",
  );

  expect(env?.CLAUDE_CONFIG_DIR).toBe("C:/Users/ady/.tessera/claude-config/openrouter");
  expect(invoked).toHaveBeenCalledWith("claude_routed_config_dir", {
    key: "openrouter",
    model: "openrouter/free",
    cwd: "C:/project",
  });
});

it("asks for an output budget a free OpenRouter route can afford", async () => {
  // Without this the CLI requests 64k output tokens and every free-tier
  // request dies with "API Error: 402 ... can only afford 688".
  const env = await buildRoutingEnv({ gateway: "openrouter", model: "openrouter/free" });
  expect(Number(env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS)).toBeLessThanOrEqual(8192);
});

it("still routes when the private config home cannot be created", async () => {
  invoked.mockImplementation(async (cmd: string) => {
    if (cmd === "claude_routed_config_dir") throw new Error("read-only disk");
    return "";
  });

  const env = await buildRoutingEnv({ gateway: "openrouter", model: "openrouter/free" });

  expect(env?.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api");
  expect(env?.CLAUDE_CONFIG_DIR).toBeUndefined();
});

it("keys a custom gateway by its URL, not the shared 'custom' name", async () => {
  await buildRoutingEnv({ gateway: "custom", customBaseUrl: "http://10.0.0.5:8080", model: "qwen3" });
  expect(invoked).toHaveBeenCalledWith("claude_routed_config_dir", {
    key: "http://10.0.0.5:8080",
    model: "qwen3",
    cwd: null,
  });
});
