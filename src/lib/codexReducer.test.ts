import { beforeEach, describe, expect, it } from "vitest";
import { emptyCodexState, reduceCodex } from "./codexReducer";
import { useCodexStore } from "../store/codexStore";
import type { CodexEvent, CodexSnapshot } from "../types/codex";

const event = (
  sequence: number,
  method: string,
  params: Record<string, unknown> = {},
  generation = "g",
): CodexEvent => ({
  id: "panel",
  sequence,
  generation,
  message: { method, params },
});
const snapshot = (events: CodexEvent[] = []): CodexSnapshot => ({
  generation: "g",
  threadId: "thread",
  thread: {
    id: "thread",
    cwd: "project",
    updatedAt: 0,
    turns: [
      {
        id: "old",
        status: "completed",
        items: [{ id: "old-answer", type: "agentMessage", text: "History" }],
      },
    ],
  },
  events,
  requests: [],
  busy: false,
  alive: true,
});

describe("Codex event isolation and recovery", () => {
  beforeEach(() =>
    useCodexStore.setState({ sessions: {}, events: {}, hydrated: {} }),
  );
  it("ignores duplicate deltas, stale generations and other threads", () => {
    const delta = event(1, "item/agentMessage/delta", {
      threadId: "thread",
      itemId: "answer",
      delta: "Hello",
    });
    const state = reduceCodex(
      { ...emptyCodexState("g"), threadId: "thread" },
      delta,
    );
    expect(reduceCodex(state, delta)).toBe(state);
    expect(
      reduceCodex(state, { ...delta, sequence: 2, generation: "old" }),
    ).toBe(state);
    const other = reduceCodex(
      state,
      event(2, "turn/started", { threadId: "other" }),
    );
    expect(other.busy).toBe(false);
    expect(other.items[0].text).toBe("Hello");
  });
  it("reconciles completed items with streaming text", () => {
    let state = reduceCodex(
      emptyCodexState("g"),
      event(1, "item/agentMessage/delta", { itemId: "a", delta: "Hel" }),
    );
    state = reduceCodex(
      state,
      event(2, "item/completed", {
        item: { id: "a", type: "agentMessage", text: "Hello" },
      }),
    );
    expect(state.items).toHaveLength(1);
    expect(state.items[0].text).toBe("Hello");
  });
  it("hydrates history while preserving live events received during configuration", () => {
    const store = useCodexStore.getState();
    const delta = event(1, "item/agentMessage/delta", {
      itemId: "a",
      delta: "Hello",
    });
    store.receive(delta);
    store.receive(
      event(2, "item/agentMessage/delta", { itemId: "a", delta: " world" }),
    );
    store.hydrate("panel", snapshot([delta]));
    expect(
      useCodexStore.getState().sessions.panel.items.map((i) => i.text),
    ).toEqual(["History", "Hello world"]);
  });
  it("keeps an unsent thread non-resumable when ready arrives before the configure reply", () => {
    const store = useCodexStore.getState();
    const ready = event(1, "tessera/ready", { threadId: "thread" });
    store.receive(ready);
    const empty = {
      ...snapshot(),
      thread: { ...snapshot().thread, turns: [] },
    };
    store.hydrate("panel", empty);
    expect(useCodexStore.getState().sessions.panel.materialized).toBe(false);
    // Remounting a hidden/grouped panel must not change its persistence state.
    store.hydrate("panel", empty);
    expect(useCodexStore.getState().sessions.panel.materialized).toBe(false);
  });
  it("retains a real first turn that arrives before the configure reply", () => {
    const store = useCodexStore.getState();
    store.receive(event(1, "tessera/ready", { threadId: "thread" }));
    store.receive(event(2, "turn/started", { threadId: "thread" }));
    store.hydrate("panel", {
      ...snapshot(),
      thread: { ...snapshot().thread, turns: [] },
    });
    expect(useCodexStore.getState().sessions.panel.materialized).toBe(true);
  });
  it("retains transcript older than the replay buffer when a hidden panel remounts", () => {
    const store = useCodexStore.getState();
    store.hydrate("panel", snapshot());
    store.receive(
      event(1, "item/completed", {
        item: { id: "a", type: "agentMessage", text: "Keep me" },
      }),
    );
    for (let n = 2; n < 4200; n++)
      store.receive(event(n, "thread/status/changed", {}));
    store.hydrate("panel", snapshot([event(4199, "thread/status/changed")]));
    expect(
      useCodexStore.getState().sessions.panel.items.map((i) => i.text),
    ).toEqual(["History", "Keep me"]);
  });
  it("does not resurrect requests resolved during or before hydration", () => {
    const request: CodexEvent = {
      ...event(1, "item/fileChange/requestApproval"),
      message: {
        method: "item/fileChange/requestApproval",
        id: 42,
        params: {},
      },
    };
    const store = useCodexStore.getState();
    store.receive(request);
    store.receive(
      event(2, "turn/completed", { turn: { status: "interrupted" } }),
    );
    store.hydrate("panel", {
      ...snapshot([request]),
      requests: [request.message as never],
      busy: true,
    });
    expect(useCodexStore.getState().sessions.panel.requests).toEqual([]);
    expect(useCodexStore.getState().sessions.panel.busy).toBe(false);
    store.remove("panel");
    store.hydrate("panel", snapshot([request]));
    expect(useCodexStore.getState().sessions.panel.requests).toEqual([]);
  });
  it("disconnects fail closed and a new generation resumes only through hydrate", () => {
    const store = useCodexStore.getState();
    store.hydrate("panel", snapshot());
    store.receive(
      event(1, "tessera/disconnected", { message: "Process ended" }),
    );
    store.receive(event(1, "turn/started", {}, "new"));
    expect(useCodexStore.getState().sessions.panel.connected).toBe(false);
    store.hydrate("panel", { ...snapshot(), generation: "new" });
    expect(useCodexStore.getState().sessions.panel.connected).toBe(true);
    expect(useCodexStore.getState().sessions.panel.busy).toBe(true);
  });
});
