# Activity history

Open **View → Activity & Token Flow**, or **Activity** in the sidebar. The view can
be pulled into a panel and expanded. Its flow graph separates named chats into
lanes and shows the provider on every card; the timeline lists the same records.
Select a card to read its question, responses, incoming/outgoing handoffs, and
input/output/cache breakdown. Search, provider/chat filters, a date range, zoom,
pan, fit, and jump-to-latest controls help navigate larger histories. The export
button saves the loaded, filtered records as JSON. Totals apply to those records;
use **Load older** for earlier pages. The graph draws the newest 100 filtered
records, while the timeline exposes all loaded records.

## Recording and attribution

The Rust backend records locally in `tessera.db`, using the existing app data
directory. Recording works without the Activity view or the destination panel
being mounted, and data remains after a panel closes or Tessera restarts.

- **Claude chat and terminal:** incrementally read the transcript of sessions
  registered to Tessera panels, including available earlier history. A user
  question starts a turn. Tool results, metadata, and compaction summaries do not.
  Text blocks are retained, but usage is replaced per assistant message ID so
  repeated blocks cannot multiply the input count. Interrupted final JSONL lines
  are retried. Provider completion markers are preserved; otherwise status is
  `recorded`, not an inferred success.
- **Codex chat and terminal:** record structured turn/item/usage notifications
  from the owned app-server, including multiple user sends during one turn.
  Cumulative counters produce deltas. The counter baseline and turn update commit
  in one transaction and survive restarts. On a previously unobserved resumed
  thread, use only the last reported request and label the possible missing usage;
  never assign its whole lifetime usage to the current question.
- **Antigravity chat:** record the structured turn events of each panel's own `agy` process:
  your message, tool names, response text, status, and usage. agy reports usage as a counter for
  the whole conversation (it keeps growing after a resume), so each turn stores the difference
  from a baseline that commits with the turn. A conversation first observed mid-life uses only
  that turn's own reported steps and is labeled; a stopped turn keeps only its completed steps;
  a turn without any reported usage stays unavailable. Events repeated after a turn has ended
  change nothing. Thinking tokens are part of output and are not added again.
- **Between panels:** record sender and destination IDs, names, providers, message,
  delivery state, and time. Local deliveries carry a UUID in the existing
  `panel-message` header. The destination turn uses that UUID to link to the
  handoff. The source turn is linked only when identifiable. Chat names are labels,
  never routing or correlation keys. Filtered/missing parents are not replaced by
  guessed links. Handoff records themselves have no token charge.

The normalized total is new input + cache read + cache write + output. Codex's
reasoning count is a subset of output and is not added again. Missing usage stays
unavailable, distinct from a reported zero. A message's content is not its token
cost: the turn includes the provider's reported processing of context and tools.

## Coverage

This version records Claude, Codex and Antigravity chat panels on this computer. Codex recording
begins when this build runs; earlier Codex turns are not backfilled. Closed Claude
sessions that have never been opened in this build are not scanned. Internal
subagent transcripts, independent CLI windows, direct LLM/OpenCode turns, Antigravity
terminal panels (the native TUI reports no structured events or usage), and
remote PC token streams are not collected. Outgoing panel handoffs to those
destinations can appear with unavailable receiver usage. Existing messages without
an activity UUID retain their text but do not acquire invented historical links.

Chat/provider labels are snapshots at recording time. SQLite errors are surfaced
in Activity. Export is explicit; this recorder does not send message content to
an external analytics service.

## Validation

`npm test -- src/lib/activityGraph.test.ts` checks graph causality, identical chat
names, filtering boundaries, usage totals, and deduplication. Activity Rust tests
cover provider parsing, cumulative usage, partial JSONL writes, persistent history,
interruption, trace IDs, and Antigravity's cumulative, resumed, interrupted, duplicated and missing usage. On Windows run `tools/test-rust.ps1 -Stable` to embed
the manifest required by native test binaries. With `npm run dev` running,
`node tools/test-activity.mjs` exercises the real React view with synthetic records.
