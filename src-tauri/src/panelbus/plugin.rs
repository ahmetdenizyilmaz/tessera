//! Ships a Claude Code plugin (skill + slash commands) to every session the
//! app spawns, via `--plugin-dir`.
//!
//! The files are embedded in the binary and written to `~/.tessera/plugin/`
//! at startup rather than bundled as Tauri resources: `tauri.conf.json`
//! declares no `resources`, and runtime-writing behaves identically in dev and
//! in the packaged app. They are rewritten unconditionally — five small files,
//! and a staleness check is more code than the copy it would save.
//!
//! `--plugin-dir` is session-scoped, so none of this leaks into the user's own
//! Claude Code setup outside the app.

use std::path::PathBuf;

const PLUGIN_JSON: &str = include_str!("../../resources/plugin/.claude-plugin/plugin.json");
const SKILL_MD: &str = include_str!("../../resources/plugin/skills/panel-messaging/SKILL.md");
const CMD_PANELS: &str = include_str!("../../resources/plugin/commands/panels.md");
const CMD_SEND: &str = include_str!("../../resources/plugin/commands/send.md");
const CMD_ASK: &str = include_str!("../../resources/plugin/commands/ask-panel.md");

/// Absolute path of the installed plugin directory, or `None` if it could not
/// be written (in which case sessions simply spawn without it).
pub fn ensure_installed() -> Option<PathBuf> {
    let root = dirs::home_dir()?.join(".tessera").join("plugin");

    let files: [(&str, &str); 5] = [
        (".claude-plugin/plugin.json", PLUGIN_JSON),
        ("skills/panel-messaging/SKILL.md", SKILL_MD),
        ("commands/panels.md", CMD_PANELS),
        ("commands/send.md", CMD_SEND),
        ("commands/ask-panel.md", CMD_ASK),
    ];

    for (rel, contents) in files {
        let path = root.join(rel);
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!("[panelbus] could not create {}: {}", parent.display(), e);
                return None;
            }
        }
        if let Err(e) = std::fs::write(&path, contents) {
            eprintln!("[panelbus] could not write {}: {}", path.display(), e);
            return None;
        }
    }

    Some(root)
}

/// Where the plugin's slash commands live, for the app's own command popup.
pub fn commands_dir() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".tessera").join("plugin").join("commands"))
}

pub fn plugin_dir() -> Option<PathBuf> {
    let dir = dirs::home_dir()?.join(".tessera").join("plugin");
    dir.exists().then_some(dir)
}
