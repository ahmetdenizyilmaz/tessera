// Monotonic activity counters avoid store updates on every terminal byte.
// Both user input and fresh output invalidate an in-progress idle check.
const revisions = new Map<string, number>();
const focused = new Map<string, Set<string>>();
const terminalDrafts = new Set<string>();
export function noteTerminalInput(id: string, data: string) {
  // Cursor reports, OSC colour replies and focus reports are protocol traffic.
  if (/^\x1b\](?:\d+);/.test(data) || /^\x1b\[(?:[\d;?]*[Rcn]|[IO])$/.test(data)) return;
  touchPanel(id);
  if (data.startsWith('\x1b[200~')) terminalDrafts.add(id);
  else if (/[\r\n\x03]/.test(data)) terminalDrafts.delete(id);
  else if (/^\x1b\[[AB]$/.test(data)) terminalDrafts.add(id);
  else if (data.replace(/\x1b\[[0-9;?]*[a-zA-Z~]/g, '').length) terminalDrafts.add(id);
}
export function hasTerminalDraft(id: string) { return terminalDrafts.has(id); }
export function touchPanel(id: string) { revisions.set(id, (revisions.get(id) ?? 0) + 1); }
export function panelActivityRevision(id: string) { return revisions.get(id) ?? 0; }
export function setPanelViewed(id: string, viewed: boolean, source = 'panel') {
  const sources = focused.get(id) ?? new Set<string>();
  if (viewed) sources.add(source); else sources.delete(source);
  if (sources.size) focused.set(id, sources); else focused.delete(id);
}
export function isPanelViewed(id: string) { return focused.has(id); }
export function forgetPanelActivity(id: string) { revisions.delete(id); focused.delete(id); terminalDrafts.delete(id); }
