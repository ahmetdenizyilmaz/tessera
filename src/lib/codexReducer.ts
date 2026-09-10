import type {
  CodexEvent,
  CodexItem,
  CodexRequest,
  CodexState,
  CodexThread,
} from "../types/codex";

export function emptyCodexState(generation = ""): CodexState {
  return {
    generation,
    sequence: 0,
    items: [],
    requests: [],
    busy: false,
    connected: true,
  };
}
export function historyItems(thread: CodexThread): CodexItem[] {
  return (thread.turns ?? []).flatMap((t) => t.items ?? []);
}
function upsert(items: CodexItem[], item: CodexItem): CodexItem[] {
  const index = items.findIndex((i) => i.id === item.id);
  if (index < 0) return [...items, item];
  return items.map((old, i) => (i === index ? { ...old, ...item } : old));
}
export function reduceCodex(state: CodexState, event: CodexEvent): CodexState {
  if (state.generation && state.generation !== event.generation) return state;
  if (event.sequence <= state.sequence) return state;
  const p = event.message.params ?? {};
  if (
    typeof p.threadId === "string" &&
    state.threadId &&
    p.threadId !== state.threadId
  )
    return { ...state, sequence: event.sequence };
  let next = {
    ...state,
    generation: event.generation,
    sequence: event.sequence,
  };
  if (event.message.id !== undefined) {
    const req = event.message as CodexRequest;
    next.requests = [...next.requests.filter((r) => r.id !== req.id), req];
    return next;
  }
  switch (event.message.method) {
    case "tessera/ready":
      return { ...next, threadId: String(p.threadId), connected: true };
    case "item/started":
    case "item/completed":
      return { ...next, items: upsert(next.items, p.item as CodexItem) };
    case "item/agentMessage/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta": {
      const id = String(p.itemId);
      const old = next.items.find((i) => i.id === id);
      const command = event.message.method.includes("commandExecution");
      const reasoning = event.message.method.includes("reasoning");
      const field = command ? "aggregatedOutput" : "text";
      const item: CodexItem = {
        id,
        type: command
          ? "commandExecution"
          : reasoning
            ? "reasoning"
            : "agentMessage",
        ...old,
      };
      item[field] = String(item[field] ?? "") + String(p.delta ?? "");
      return { ...next, items: upsert(next.items, item) };
    }
    case "turn/started":
      return { ...next, busy: true, materialized: true, error: undefined };
    case "turn/completed": {
      const turn = p.turn as { status?: string; error?: { message?: string } };
      return { ...next, busy: false, requests: [], error: turn.error?.message };
    }
    case "serverRequest/resolved":
      return {
        ...next,
        requests: next.requests.filter((r) => r.id !== p.requestId),
      };
    case "thread/tokenUsage/updated":
      return { ...next, usage: p.tokenUsage as Record<string, unknown> };
    case "tessera/disconnected":
      return {
        ...next,
        connected: false,
        busy: false,
        requests: [],
        error: String(p.message ?? "Codex disconnected"),
      };
    case "tessera/error":
      return { ...next, error: String(p.message ?? "Codex error") };
    case "error":
      return {
        ...next,
        error: String(
          (p.error as { message?: string })?.message ??
            p.message ??
            "Codex error",
        ),
      };
    default:
      return next;
  }
}
