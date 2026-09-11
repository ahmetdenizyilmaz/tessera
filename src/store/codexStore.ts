import { create } from "zustand";
import type { CodexEvent, CodexState, CodexSnapshot } from "../types/codex";
import {
  emptyCodexState,
  historyItems,
  reduceCodex,
} from "../lib/codexReducer";

export const useCodexStore = create<{
  sessions: Record<string, CodexState>;
  events: Record<string, CodexEvent[]>;
  hydrated: Record<string, string>;
  receive: (event: CodexEvent) => void;
  hydrate: (id: string, snapshot: CodexSnapshot) => void;
  remove: (id: string) => void;
  setError: (id: string, error?: string) => void;
}>((set) => ({
  sessions: {},
  events: {},
  hydrated: {},
  receive: (event) =>
    set((state) => {
      const current =
        state.sessions[event.id] ?? emptyCodexState(event.generation);
      // A disconnected generation can be superseded only by an explicit configure/hydrate.
      const next = reduceCodex(current, event);
      const events = [...(state.events[event.id] ?? []), event].slice(-4096);
      return {
        sessions: { ...state.sessions, [event.id]: next },
        events: { ...state.events, [event.id]: events },
      };
    }),
  hydrate: (id, snapshot) =>
    set((state) => {
      const existing = state.sessions[id];
      const queued = (state.events[id] ?? []).filter(
        (e) => e.generation === snapshot.generation,
      );
      const events = [...snapshot.events, ...queued].sort(
        (a, b) => a.sequence - b.sequence,
      );
      // Group switches remount panels. Keep the accumulated transcript, including
      // output older than the backend replay window, for an already hydrated generation.
      if (existing && state.hydrated[id] === snapshot.generation) {
        let next = existing;
        for (const event of events) next = reduceCodex(next, event);
        return { sessions: { ...state.sessions, [id]: next } };
      }
      let next: CodexState = {
        ...emptyCodexState(snapshot.generation),
        threadId: snapshot.threadId,
        items: historyItems(snapshot.thread),
        busy: snapshot.busy,
        connected: snapshot.alive,
        materialized: snapshot.materialized ?? !!snapshot.thread.turns?.length,
      };
      for (const event of snapshot.events) next = reduceCodex(next, event);
      // Requests and activity in the snapshot already include its replay events.
      next = {
        ...next,
        requests: snapshot.requests,
        busy: snapshot.busy,
        connected: snapshot.alive,
      };
      for (const event of queued.sort((a, b) => a.sequence - b.sequence))
        next = reduceCodex(next, event);
      if (
        existing?.generation === snapshot.generation &&
        existing.sequence >= next.sequence
      ) {
        // A panel first opened from a collapsed group can already have received
        // more live output than fits in the replay log.
        const items = new Map(next.items.map((item) => [item.id, item]));
        for (const item of existing.items) items.set(item.id, item);
        next.items = [...items.values()];
        // An early ready/status event can predate hydration. Keep an empty
        // thread explicitly false: undefined used to make autosave persist an
        // ID for which Codex had never written a resumable transcript.
        next.materialized = !!(next.materialized || existing.materialized);
      }
      return {
        sessions: { ...state.sessions, [id]: next },
        events: { ...state.events, [id]: events.slice(-4096) },
        hydrated: { ...state.hydrated, [id]: snapshot.generation },
      };
    }),
  remove: (id) =>
    set((state) => {
      const sessions = { ...state.sessions },
        events = { ...state.events },
        hydrated = { ...state.hydrated };
      delete sessions[id];
      delete events[id];
      delete hydrated[id];
      return { sessions, events, hydrated };
    }),
  setError: (id, error) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [id]: { ...(state.sessions[id] ?? emptyCodexState()), error },
      },
    })),
}));
