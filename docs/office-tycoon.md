# Agent office

Open **View → Office View** or press **Ctrl+G**. Each local agent panel becomes a named character with its provider, current assignment, reported action, and earned coins. Select a character or a team row to inspect its task, equip an accessory, or open the chat (including chats inside groups).

Characters walk between workstations, the library, build lab, research lab, planning room, coffee lounge, and your office. Movement uses reported tools and session states: reading goes to the library, edits to a workstation, commands/tests to the build lab, web tools to research, and approval requests to your office. This does not infer hidden reasoning or judge whether the answer is correct. Unavailable activity is labeled explicitly.

The office starts with **150 game coins**. A successfully completed conversation turn earns **30 coins**, plus **5 per distinct reported work category**, capped at a 20-coin bonus. Token usage, model price, waiting time, failed turns, and handoff messages do not generate coins. Office level advances every 10 completed turns; character level advances every five. These are local game points with no monetary value.

The shop sells individual furniture/decor pieces, reusable floor styles, and team-wide accessory unlocks. Buy a piece, choose **Place**, then click an empty tile. **Decorate → Move** repositions existing furniture; **Store** returns it to inventory. **R** rotates the selected item. Floors can be painted after unlocking. Wearables come in three slots a character wears at once: **head** (headphones, builder cap, cozy beanie, artist beret, sun visor, party hat, tiny crown, halo), **face** (reading glasses, sunglasses, monocle) and **neck** (red tie, bow tie, autumn scarf, staff lanyard); pick one per slot from the agent details. **Escape** closes the editor or shop. Furniture, inventory, coins, earned rewards, character appearance, and accessories persist on this PC. Workspace restoration remaps character profiles to the restored panels.

## Speech bubbles and agent talk

Characters never show message text; the bubble's shape says what state they are in. A **thought cloud** with pulsing dots (the character glances up) means it is only thinking; a **spinning gear** (arms typing) means it is working with tools or writing; a **?** bubble means it is waiting for your approval; a **!** bubble means its last turn failed. When one agent messages another through the `tessera-panels` MCP tools (`send_to_panel`), the sender gets a green **speech bubble with sound waves** (and a moving mouth) and a line with a travelling dot is drawn to the receiver for a few seconds. The native bus emits `panel-bus-message` for every delivery, so this works for Claude, Codex, OpenCode and Antigravity senders alike, including messages the agents exchange on their own.

**Talk with another agent** (in the agent details) asks the selected agent to discuss a topic with another panel over those same tools and report back; both chats show the exchange, and the office shows it as bubbles. The agent needs the panel tools (Claude and Codex chat panels have them; Antigravity after importing the server in Settings → Antigravity).

## Chatting from the office

The office chat has a composer: Enter sends to the selected agent without opening its panel. Rust routes it the way panel messages are routed (Claude stream, Codex, OpenCode, Antigravity chat, or a paste into a terminal panel). API (LLM) chats are answered from the full chat. An agent waiting for an approval still needs the full chat to answer it.

**Resources** lists the files, folders and links the conversation mentioned. Clicking a file reveals it in the file manager, a folder opens it, a link opens the browser.

## Clickable paths

In every chat, an inline-code path (`src/lib/office.ts`, `C:\Users\you\Desktop\app`, `~/project`) and an absolute path in prose open the file manager. Agents shorten paths inconsistently, so `open_path_smart` tries the text as written, then relative to the panel folder, the Desktop, the home folder and each drive root, and opens the first that exists; line suffixes like `:12:3` and `#L12` are ignored. Nothing is launched: folders open, files are revealed. When no candidate exists a toast says where it looked.

## Activity and reward coverage

- Claude chat uses the live structured chat store for movement. Claude terminal uses the native transcript recorder; its last reported action becomes unknown after 30 seconds without another event.
- Codex chat and terminal use the existing app-server state for movement. Claude and Codex rewards come from completed native Activity records, including after a view change or restart. Stable record IDs prevent duplicate rewards on polling or transcript replay. Only turns begun after the office game was initialized qualify; imported older history earns nothing.
- Antigravity chat uses its live session for movement: the character keeps working for the whole open turn, however quiet the output, and stops only when agy reports the turn's end (idle), a turn awaiting your reply (waiting), or a failure (error). Its rewards come from completed native Activity records, once per turn ID; stopped and failed turns earn nothing. Antigravity terminal panels have a character but report no structured activity.
- OpenCode and API chat panels use their live stores. Their rewards require observing the current turn running and then completing during this app run; historical imports are not rewarded.
- Remote LAN panels and internal subagents are not independently represented or rewarded in this version.
- The app-wide activity hook continues while Office View is closed. Entering Office View keeps the panel tree mounted so ongoing sessions and API streams continue. Native polling refreshes pending turns, paginates newer activity, and rescans from the game start every five minutes to catch delayed transcript imports. Errors remain visible and retries resume automatically.

Native records retain distinct tool **names**, not command contents or tool arguments, for work-category rewards. No additional model requests are made. The existing Activity timeline and token counts are unchanged.

## Validation

`npx vitest run src/lib/office.test.ts src/lib/activityGraph.test.ts src/lib/codexReducer.test.ts src/lib/workspaceSerializer.test.ts`

Tests cover reward replay/reload, old and failed records, restoration of character identity, provider activity, atomic purchases, bounds/overlap rejection, inventory return, accessory ownership, blocked paths, and rerouting from the animated position.

`powershell -ExecutionPolicy Bypass -File tools/test-rust.ps1 -Stable`

Includes native tool-name collection, deduplication, omission of tool inputs, and compatibility with turn/usage recording.

Start Vite, then run `node tools/test-office.mjs`. The browser fixture uses real office components, Pixi rendering, and store subscriptions with synthetic native/session data. It checks task stations, scene lifecycle, actual canvas placement, wearable slots, the office composer, clickable resources and paths (including the not-found toast), the agent huddle request, the exchange list, rewards while away, persistence, pagination, errors/recovery, narrow layout, and empty state. PNGs are saved under `../tessera-office-validation/`. No model inference or personal transcripts are used.
