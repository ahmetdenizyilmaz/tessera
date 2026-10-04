/**
 * Who is talking to whom: the panel-to-panel messages agents send through the
 * `tessera-panels` MCP tools. Rust emits `panel-bus-message` as each one is
 * delivered; the office draws it as a speech bubble and a line between the two
 * characters, and the office chat lists the recent exchanges.
 */
import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface Exchange { id: string; from: string; fromName: string; to: string; toName: string; preview: string; at: number }
/** How long a line stays drawn between the two characters. */
export const EXCHANGE_VISIBLE_MS = 4500;
const KEEP = 60;

interface TalkState { exchanges: Exchange[]; add: (e: Omit<Exchange, 'id'> & { id?: string }) => void }
export const useOfficeTalkStore = create<TalkState>(set => ({
  exchanges: [],
  add: e => set(s => ({ exchanges: [{ ...e, id: e.id ?? crypto.randomUUID() }, ...s.exchanges].slice(0, KEEP) })),
}));

/** Exchanges still recent enough to draw, newest first. */
export function liveExchanges(now = Date.now()): Exchange[] {
  return useOfficeTalkStore.getState().exchanges.filter(e => now - e.at < EXCHANGE_VISIBLE_MS);
}

/** Install once at app root so exchanges are kept even while the office is closed. */
export function initOfficeTalk(): () => void {
  let unlisten: UnlistenFn | undefined, disposed = false;
  void listen<Omit<Exchange, 'id'>>('panel-bus-message', event => {
    const p = event.payload;
    if (!p?.from || !p?.to) return;
    // Clocks differ between Rust and the webview only by drift; use ours for fading.
    useOfficeTalkStore.getState().add({ ...p, at: Date.now() });
  }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(() => {});
  return () => { disposed = true; unlisten?.(); };
}
