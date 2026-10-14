# HTML panel apps, version 1

Local HTML/CSS/JavaScript apps run as Tessera panels. Use them for calculators,
notes, games, dashboards, and small utilities. Most apps need no permissions.

## Install and use

Open **Plugins → Import HTML app…** (also in File and Manage add-ons).
Choose a self-contained `.html` file, a folder, or a ZIP containing `manifest.json`.
Review the app and any optional permissions, then choose **Install and open**.
Calculator, Quick Notes, and Memory Break are included on the import screen as
examples. Their source is in [`examples/html-apps`](../examples/html-apps).

Installed apps appear in **Plugins**, **New session → More**, and detached-window
menus. They use the same resize, grouping, lock, focus, and detach rules as other
panels. Small panels use click-to-focus; their header settings can change this.

**Manage add-ons → Permissions** changes access immediately for every instance
of that app. No optional permissions are checked by default, including updates.
Removing an app closes its panels and removes its shortcuts. Restoring it keeps
its saved data. Updating an app closes its old panels before opening the new
version; the package ID and data remain the same.

Website players such as Lichess and Instagram remain a separate option. They
load a live website with persistent cookies; they do not receive this SDK.
Legacy built-in Notepad/Timer plugins continue to work as before.

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
const note = await Tessera.storage.get('draft', '');
await Tessera.storage.set('draft', 'Remember this after restarting');
await Tessera.storage.remove('obsolete');

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
