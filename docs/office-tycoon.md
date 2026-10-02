# Agent office

Open **View → Office View** or press **Ctrl+G**. Each local agent panel becomes a named character with its provider, current assignment, reported action, and earned coins. Select a character or a team row to inspect its task, equip an accessory, or open the chat (including chats inside groups).

Characters walk between workstations, the library, build lab, research lab, planning room, coffee lounge, and your office. Movement uses reported tools and session states: reading goes to the library, edits to a workstation, commands/tests to the build lab, web tools to research, and approval requests to your office. This does not infer hidden reasoning or judge whether the answer is correct. Unavailable activity is labeled explicitly.

The office starts with **150 game coins**. A successfully completed conversation turn earns **30 coins**, plus **5 per distinct reported work category**, capped at a 20-coin bonus. Token usage, model price, waiting time, failed turns, and handoff messages do not generate coins. Office level advances every 10 completed turns; character level advances every five. These are local game points with no monetary value.

The shop sells individual furniture/decor pieces, reusable floor styles, and team-wide accessory unlocks. Buy a piece, choose **Place**, then click an empty tile. **Decorate → Move** repositions existing furniture; **Store** returns it to inventory. **R** rotates the selected item. Floors can be painted after unlocking. Select a character to equip headphones, a cap, or a crown. **Escape** closes the editor or shop. Furniture, inventory, coins, earned rewards, character appearance, and accessories persist on this PC. Workspace restoration remaps character profiles to the restored panels.

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

Start Vite, then run `node tools/test-office.mjs`. The browser fixture uses real office components, Pixi rendering, and store subscriptions with synthetic native/session data. It checks task stations, scene lifecycle, actual canvas placement, accessories, rewards while away, persistence, pagination, errors/recovery, narrow layout, and empty state. PNGs are saved under `../tessera-office-validation/`. No model inference or personal transcripts are used.
