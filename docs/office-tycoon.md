# Agent office

Open **View > Office View** or press **Ctrl+G**. Each local agent panel becomes a worker, including agents inside groups and detached windows. Browser, utility, and remote panels are not independent workers.

Names on the floor are small and muted. Hover or select a character for its full name, provider, model, and reported activity. Clicking a character opens its existing chat beside the office. **Agent details** contains its computer, shirt, headwear, eyewear, neck accessory, and income breakdown. Shirts keep the provider badge visible.

## Coins from real work

The office earns from recorded token usage, including consumed tokens on failed or interrupted requests. Idle time, walking, and handoff notifications do not generate coins. Model values use the same price table as Analytics where known; otherwise the office uses explicitly labeled game estimates. Subscriptions are not billed per token, and these coins have no monetary value.

```
base coins = token value * 10
income = base coins
       * permanent spin-off multiplier
       * (global coefficient + environment bonus + location bonus)
       * (1 + matching provider server bonus)
       * model coefficient
       * (PC multiplier + equipped accessory bonuses)
       * worker activity
```

All coefficients start at 1.000. Activity gains 0.05 per working hour and loses 0.10 per idle hour, bounded between 1 and 2. Time spent offline only decays activity; it never simulates work. Waiting for approval and unknown activity are not working time.

Global coefficient is `1 + 0.001 * log2(1 + companyBase / 100)`. Model experience is `1 + 0.002 * log2(1 + modelBase / 100)`, independent for each provider/model pair. Earnings retain fractions internally. The HUD shows whole coins; income details show three decimal places.

`src/lib/officeEconomy.ts` contains the shared balance configuration, including game-estimate model tiers. Per-million input/output/cache-read/cache-write values are 0.5/2/0.05/0.625 (Economy), 2/10/0.2/2.5 (Standard), and 4/20/0.4/5 (Premium). Unknown models use Standard. Reported cache writes use the Analytics five-minute cache rate when no duration is available. Reasoning tokens already included in output are not counted twice.

The app-wide recorder continues when the office is closed. Claude, Codex, Antigravity, and API chats including OpenRouter supply durable usage records. Unavailable provider usage earns nothing until a usage record arrives. Historical imports are not rewarded. Persistent settlement IDs and cumulative usage watermarks prevent duplicate income after polling, window moves, or restart. Late usage retains the original multiplier rather than benefiting from later purchases.

## Store and equipment

There are 64 bundled definitions, organized into separate collections for desks, chairs, sofas, plants, clothing slots, each provider's servers, and other item families. Store cards show the actual object, footprint, bonus, price, and stored quantity; click its preview to see all four orientations. Furniture and equipment are individual purchases. Floor finishes are reusable unlocks.

Five PCs cost 0 / 450 / 1,350 / 3,600 / 9,000 and multiply their worker by 1.00 / 1.08 / 1.18 / 1.32 / 1.50. Every worker receives a basic computer automatically. Buy an upgrade and assign it in that worker's **Agent details**. Replacing equipment returns the old item to storage. Closing a worker's panel returns its equipment too.

Accessories cost 30-225 and grant small individual bonuses. Most environment items cost 30-1,500; the archive appliance costs 3,000. Only the strongest item per environment family applies, capped at +0.25 overall; stored objects and supplied starter furniture grant no environment bonus. Server upgrades cost 3,000 / 10,000 / 30,000 with +0.06 / +0.16 / +0.30 for Claude, Codex, Antigravity, or OpenRouter. Only the best placed server for each provider applies. This balance revision preserves existing balances and possessions.

## Expanding and arranging

The office appends workstation capacity as panels join without moving existing furniture. **Company > Expand studio** adds a four-tile-deep decorating module, starting at 450 coins and doubling for each purchase. Closing panels frees their basic workstations for reuse.

Locations change the exterior while preserving furniture and capacity: starter studio, city office (12,000, +0.06), plaza (40,000, +0.16), and seaside (100,000, +0.30). Only the current location gives a bonus.

Buying furniture opens placement immediately. The first copy is paid for and remains in storage if cancelled. Continue clicking valid spots to place more copies; stored copies are used first, and further copies are charged only on valid placement. Placement and its ghost end automatically when there are no stored copies and insufficient coins. Selecting an item from storage never enables automatic purchases.

Hovering furniture highlights its footprint and slightly lifts it. Double-click an object to pick it up, or use **Decorate > Move**. A translucent preview and the entire rotated grid footprint follow the pointer. **Mouse wheel**, **R**, or **Rotate** changes orientation; click or drag to place; **Escape** cancels without changing the original object. The camera buttons still zoom, and Shift-drag pans. Green footprints are valid; red footprints indicate blocked placements. Keep workstation approaches, seat approaches, and walking routes clear. Rugs and floor decorations can sit beneath furniture. Drag a picked object into the bottom-right **Return to storage** target (or click it) to store the object and finish pickup. Unpurchased repeat previews are not converted to inventory. Supplied workstation capacity cannot be packed away.

Workers use pathfinding for reported task destinations. Idle workers occasionally walk, rest, or reserve a couch/chair seat while Office View is visible. Work interrupts wandering. Animation is cosmetic and does not increase income. Office View does not need to stay open.

## Company spin-offs

Find the red reset action under **Company > Advanced**. A preview and second confirmation explain everything that resets: coins, furniture, outfits, equipment, location, expansions, activity, and model experience. Chats, provider sessions, files, and panel identities are never reset.

The company needs at least 250 fresh **base coins before bonuses**. The spin-off factor is:

`1 + floor(10 * log2(1 + companyBase / 250)) / 100`

750 base coins grants x1.20; 1,750 grants x1.30. Factors multiply permanently, so x1.20 followed by x1.30 yields x1.56. Lifetime statistics survive; other game progression starts over. Earlier records cannot earn again in the new company.

## Adding content

Copy a JSON definition in `src/content/office/`, change its stable ID, and rebuild. Each single file contains:

- `version: 1`, ID, name, description, category, price, and a legacy furniture archetype when applicable.
- `footprint`, `collision` grid cells, and optional `interaction` approach cells.
- Four SVG strings in `art`, with a shared pixel `anchor`. Artwork is drawn at the tile origin. Each SVG must supply width, height, and viewBox.
- Optional `seats`: local fractional tile positions and integer approach cells in the unrotated view. The engine rotates these with the furniture.
- Optional `bonus`: scope (`worker`, `environment`, `provider`), amount, environment family, or provider.
- Wearable slot, color, attachment position/scale, and shirt badge anchor; PCs use `pcMultiplier`.

Use the existing plant, couch, shirt, or server file as a template. Definition validation rejects scripts, external resources, executable SVG, bad footprints, and malformed bonuses. The renderer supports a restricted SVG shape subset. `tools/generate-office-catalog.py` reproduces the bundled artwork; running it overwrites the shipped definitions, so hand-authored additions should use new IDs. Downloading items from the internet is not implemented.

## Save upgrade and verification

Save version 3 backs up the preceding office state under `tessera-office-before-tycoon-v3`. Furniture and currently equipped outfits survive. Ten old coins become one new coin; old earnings remain a separate lifetime statistic. New coefficient growth and spin-off eligibility start at the update, with no retrospective rewards.

Run `npm test` for economy, migration, placement, pathfinding, and reward replay tests. With Vite running, `node tools/test-office-tycoon.mjs` exercises store purchases, equipment, canvas placement, rotations, cancellation, thirty-worker expansion, locations, spin-offs, narrow layout, and persistence using synthetic sessions. `tools/test-office.mjs` retains broader chat, activity, pagination, and scene lifecycle coverage. Screenshots are saved in `../tessera-office-validation/`.

The isolated `office_validation` native example uses a separate profile with synthetic data, starts hidden, and exits automatically after three minutes. It never loads the user's agents or database.
