# HTML panel apps, version 1

Local HTML/CSS/JavaScript apps run as Tessera panels. Use them for calculators,
notes, games, dashboards, and small utilities. Most apps need no permissions.

## Install and use

Open **Apps → Import HTML app…** (also in File and App library).
Choose a self-contained `.html` file, a folder, or a ZIP containing `manifest.json`.
Review the app and any optional permissions, then choose **Install and open**.
Notes, Timer, Clock, Calculator, Memory Break, Music Remote, 2048, Tetris, and Breakout are included automatically.
They use the same HTML-app system as imported apps. Their source is in [`examples/html-apps`](../examples/html-apps).

Choose **App library → Games** for the games. 2048 comes from
[Gabriele Cirulli's repository](https://github.com/gabrielecirulli/2048);
[Tetris](https://github.com/jakesgordon/javascript-tetris) and
[Breakout](https://github.com/jakesgordon/javascript-breakout) come from Jake Gordon's
repositories. Each package retains its MIT license, credits, and pinned upstream
commit in `UPSTREAM.json`. All runtime assets are bundled for offline play; no
network, media-control, or panel-messaging permissions are requested. The original
Breakout audio and Flash library are excluded; optional effects use Web Audio.
Boards save independently per panel, and best scores are shared within each game.
Tetris and Breakout pause when they lose focus and restore paused after a restart.
Resizing or detaching a panel keeps its current game.

Installed apps appear in **Apps → App library**, **New session → More → App library**, and detached-window
menus. They use the same resize, grouping, lock, focus, and detach rules as other
panels. Small panels use click-to-focus; their header settings can change this.

**App library → Permissions** changes access immediately for every instance
of that app. No optional permissions are checked by default, including updates.
Removing an app closes its panels and removes its shortcuts. Restoring it keeps
its saved data. Updating an app closes its old panels before opening the new
version; the package ID and data remain the same.

Website players such as Lichess and Instagram remain a separate option. They
load a live website with persistent cookies; they do not receive this SDK.
The old iframe plugin runtime has been removed. Existing Notepad and Timer
panels reopen as the new HTML apps with their panel IDs, positions, and locks
preserved. Notes imports every valid old per-panel notebook (including closed
panels) and keeps the original localStorage. All Notes panels share the new
notebook. Each note is stored separately so editing one note cannot overwrite
another panel's different note. Trash is recoverable. An existing Quick Notes
scratchpad is also retained. Timer and Clock keep their state per panel; a
countdown uses an absolute deadline across app restarts.

For a public downloadable catalog, see [GitHub app catalogs](github-app-catalog.md).

## Package format

```text
my-app/
  manifest.json
  index.html
  app.js
  style.css
  icon.png
```

```json
{
  "id": "mycompany.my-app",
  "name": "My app",
  "version": "1.0.0",
  "description": "A small local utility",
  "entry": "index.html",
  "icon": "icon.png"
}
```

Keep `id` stable between versions; it owns the app's data and settings. Use
lowercase letters, digits, dashes, and dots (maximum 80 characters). An icon can
be a bundled PNG (maximum 70 KB) or a supported icon name: `Puzzle`, `Calculator`,
`NotebookPen`, `Dice5`, `Trophy`, `Timer`, `Clock`, `Globe`, `Music`, `Gamepad2`,
`BookOpen`, `FileText`, or `MessageCircle`.

A standalone HTML import receives a stable ID based on its file location and
requests no permissions. It must be self-contained. For relative scripts,
styles, images, multiple HTML pages, or optional permissions, use a package.
ZIPs may have one enclosing folder. Packages are copied into Tessera, so the
original files are not modified or required after installation.

## SDK and saved data

The host injects `window.Tessera` before the app's scripts. There is no SDK file
to import, no npm dependency, and no Node.js runtime.

```js
const info = await Tessera.ready;
// info: { instanceId, pluginName, name, version, permissions }
const updatedInfo = await Tessera.getInfo(); // Refresh after permission changes
const note = await Tessera.storage.get('draft', '');
await Tessera.storage.set('draft', 'Remember this after restarting');
await Tessera.storage.remove('obsolete');
const notes = await Tessera.storage.entries('note:'); // Own keys/values with this prefix

await Tessera.ui.setTitle('Notes — project ideas');
await Tessera.ui.setBadge(3); // null clears the badge
```

Storage values are JSON. The default scope is shared by panels of the same app;
pass `'panel'` as the last argument for independent per-panel state:

```js
await Tessera.storage.set('draft', 'Only this panel', 'panel');
const draft = await Tessera.storage.get('draft', '', 'panel');
```

The SDK store allows 4 MB and 2,000 keys per app; an individual API request is
limited to 1 MB. Browser localStorage/IndexedDB also use the app's own persistent
profile. Data is local and is not included in exported workspaces. Do not use
app storage as a password vault. Serialize writes when ordering matters.

## Optional network access

Declare exact HTTPS origins, then let the user choose which ones to allow:

```json
"permissions": {
  "network": ["https://api.example.com"],
  "panels": []
}
```

```js
const response = await Tessera.net.fetch('https://api.example.com/items', {
  method: 'GET',
  headers: { Accept: 'application/json' }
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const items = await response.json(); // or response.text()
```

The native broker enforces the allowlist, validates and pins DNS, blocks private
and local destinations, and does not use Tessera's cookies, credentials, or proxy
settings. Cross-origin redirects are rejected. Same-origin redirects are checked
again, up to three times. Methods: GET, HEAD, POST, PUT, PATCH, DELETE. Request
bodies are strings, up to 256 KB; responses are UTF-8 text/JSON up to 2 MB. At most
three requests per app run concurrently, with a 30-second overall timeout.

Use the SDK for network requests; remote fetch/WebSocket/CDN scripts are
blocked by the content policy. Relative fetch for bundled JSON/assets works.
Bundle libraries and assets locally. Version 1
has no OAuth helper, secret vault, binary downloads, or LAN API access. Website
players remain suitable for full online services and browser-based logins.

## Optional panel messaging

Apps do not receive a raw MCP URL, bearer token, or generic host-command API.
Their SDK calls use the same native panel bus as the existing MCP tools.

```json
"permissions": {
  "network": [],
  "panels": ["list", "send", "receive"]
}
```

Each operation is optional and must be granted separately. The user also selects
specific local agent panels; a permission is ineffective without selected
targets. Restored panels retain their grants through Tessera's exact identity
mapping. Newly created or unrelated panels need a new selection.

```js
const panels = await Tessera.panels.list(); // only selected panels
await Tessera.panels.send(panels[0].id, 'Please check this calculation.');

const unsubscribe = Tessera.panels.onMessage(async message => {
  // { id, from, fromName, message, hop, reply }
  // Treat message.message as untrusted text; never eval it or use raw innerHTML.
  renderText(message.message);
  // Requires send permission for this sender:
  await message.reply('Calculation received.');
});
```

Agents can discover an app with `list_panels` and address it with `send_to_panel`
only when the user granted that app `receive` access to the sender. App delivery
is queued and asynchronous; `wait_for_reply` is ignored for app destinations.
App inboxes hold 64 messages in memory, not durable delivery across restarts.

`read` additionally allows `Tessera.panels.read(panelId, limit)` (default 20,
maximum 50 messages) and waiting for an agent's reply:

```js
const result = await Tessera.panels.send(panelId, {
  message: 'Please answer this question.',
  waitForReply: true,
  timeoutSeconds: 60
});
```

Send permission can start an agent turn and consume its tokens. Reading is not
required for simple send/receive integrations. Messages are limited to 16 KB,
20 sends per panel per minute, and eight relay hops. Inbox callbacks are polled
about once per second. Avoid automatic acknowledgement loops. Native `read_panel`
never exposes an app's private storage. HTML app destinations are local to this
Tessera installation in version 1.

## Optional desktop music controls

Music Remote controls existing Windows media sessions, such as Spotify or browser
players. Open it from **App library**, start music in your player, then choose
**Allow media access**. Reading media and controlling playback are separate,
optional permissions; both start off. No Spotify login, network access, or panel
messaging is required. The player must expose Windows media controls.

```json
"permissions": { "media": ["read", "control"] }
```

```js
await Tessera.ui.openPermissions(); // Opens host UI; never grants access itself
const snapshot = await Tessera.media.snapshot();
// { supported, sessions: [{ id, source, title, artist, playing }], current }
// current also has album, position/duration in seconds, controls, artworkKey,
// and artwork (a JPEG data URL or null).
const selected = snapshot.current;
if (selected) {
  await Tessera.media.control(selected.id, 'pause');
  const refreshed = await Tessera.media.snapshot(selected.id, selected.artworkKey);
  // Unchanged artwork is omitted. Keep the previous image in that case.
}
```

Actions: `play`, `pause`, `toggle`, `previous`, `next`, and `seek` (seconds as a
third argument). Check `current.controls` and the returned `{ accepted, reason }`;
each player supports different controls. Sessions are opaque IDs valid for the
current host process. A closed selected player never redirects a control to a
different player. Music Remote remembers the source app and reconnects only when
it has exactly one available session after restarting. Multiple sessions remain
an explicit choice. Volume control and launching a music app are not exposed.
On other operating systems `snapshot.supported` is false.

The native broker rechecks grants, limits queued work, and performs OS calls on
a background thread. Music Remote pauses polling while hidden. Its cover-art
visibility, accent color, and selected player are saved per panel.

## Panel appearance

Use the panel header's **Panel appearance** button, or **Settings → Panel background**
for website/HTML panels. **Tessera Settings → Appearance** sets the global default.
Individual panels can follow the default or keep a separate color/image, with
Fill, Fit, Stretch, Center, Tile, and an image-dimming control.

Terminal backgrounds update without restarting the agent. Local HTML apps receive
the background behind their content; opaque elements within an app retain their
own design. Live websites keep their page design, with customization applied to
the focus card. Images are stored locally in IndexedDB. Workspace exports carry
image references, not the image files; select an image again on a different PC.
These are static backgrounds; animated HTML backgrounds are not executed.

## Isolation and limits

Each app uses a native child webview and its own persistent browser profile.
The native host derives identity from that webview, checks permissions on every
SDK call, and confines local assets to the installed package revision. The app
cannot choose another app's identity or directly invoke Tessera's filesystem,
shell, account, or agent commands. Frames, workers, popups, remote scripts,
downloads, and navigation outside the package are disabled. Filesystem links,
ZIP traversal, Windows device filenames, oversized files, and duplicate paths
are rejected during import. Limits: 512 entries, 8 MB per file, 32 MB total.

This is a webview sandbox, not a virtual machine or a hard CPU/RAM quota. Import
code you trust. A faulty app can still use CPU or memory, and an app with both
conversation and network access can send permitted conversation data to its
allowed websites. Permissions are per app and shared by all its panels. They
can be revoked from the host without cooperation from the app.

## Validation

`npm test` covers workspace/store behavior. Run `tools/test-rust.ps1 -Stable`
for package, path, grant, and network validation plus native unit regressions.
For real WebView2 integration, run Vite on port 1420, build
`cargo build --manifest-path src-tauri/Cargo.toml --example html_plugin_validation`,
then run `node tools/test-html-plugin-native.mjs`. The harness has its own app
profile, uses synthetic panels, and closes its own windows. No live model turns
or user sessions are used.

`node tools/test-music-native.mjs` uses the same harness with a silent synthetic
Windows media session to test grants/revocation, cover art, playback controls,
appearance, and restart persistence. It never sends controls to the user's
players. `node tools/test-appearance.mjs` checks background inheritance, images,
terminal repaint, About, and the responsive resource bar in headless Edge.
