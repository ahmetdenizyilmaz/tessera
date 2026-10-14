# A public app library for Tessera

Open **Apps → App library → Get apps**, enter your public repository URL, and
choose **Load catalog**. Leave the branch field empty to use the repository's
default branch, or enter a branch/tag. No GitHub token is needed. Nothing is
fetched until you choose Load catalog. The last successfully loaded source is
remembered. Installed apps continue working offline.

## Prepare your repository

Each app is a folder with `manifest.json`, an HTML entry point, and any local
assets. See [the HTML app guide](html-panel-plugins.md) and `examples/html-apps/`.
Build the distribution files into your new repository:

```powershell
python tools/build-app-catalog.py examples/html-apps --output C:/projects/tessera-apps
```

Review and commit `tessera-apps.json` and `packages/*.zip` to that public repo.
The helper does not publish anything. Use your own app IDs (for example
`yourname.calculator`) for new apps; keep the same ID for future updates.
Accept contributions through normal pull requests to your app source folders,
then rebuild the catalog when releasing changes. Review HTML/JavaScript and
requested permissions before merging a contribution.

The root catalog has this format:

```json
{
  "version": 1,
  "apps": [{
    "id": "example.timer",
    "name": "Focus Timer",
    "version": "1.0.0",
    "description": "A small countdown timer.",
    "category": "Tools",
    "icon": "Timer",
    "package": "packages/example.timer.zip",
    "sha256": "<64-character SHA-256 of the ZIP bytes>"
  }]
}
```

The package's ID, name, and version must match the catalog. The ZIP must contain
`manifest.json` at its root (one enclosing folder is also accepted). Supported
catalog icons are the named icons in the HTML app guide. The installed app may
use a bundled PNG icon. Catalogs support up to 128 apps, 1 MB of JSON, and
32 MB per ZIP; extracted package limits also apply.

## Downloads and updates

Tessera resolves the selected branch to one commit before reading its catalog.
It downloads the chosen ZIP from that same commit and checks its SHA-256 before
opening the install preview. Catalog entries cannot redirect to another host or
read files from the computer. SHA-256 checks consistency with the selected
repository; it is not a publisher signature or a guarantee about app behavior.

The preview shows the real package permissions. Network access and agent
messaging start disabled and require explicit selection. Apps without those
permissions, including Notes, Timer, Clock, Calculator and Memory Break, work
entirely locally. Updating an app is manual, closes its open panels, retains
saved data, and asks you to review permissions again. Removal keeps saved data
and website logins. There is no automatic background installation or update.

Public GitHub access is subject to its unauthenticated rate limit. A missing
catalog, private repository, bad checksum, or unavailable network produces an
error in the library and leaves installed apps intact.

GitHub behavior follows its [repository contents API](https://docs.github.com/en/rest/repos/contents).
