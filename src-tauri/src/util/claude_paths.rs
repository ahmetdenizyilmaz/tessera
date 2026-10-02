use std::path::PathBuf;

/// Find the claude executable on this system.
/// Checks common install locations first, then falls back to searching PATH.
pub fn find_claude_exe() -> Option<PathBuf> {
    // Check ~/.local/bin (typical npm global install location on Windows)
    if let Some(home) = dirs::home_dir() {
        let local_bin = home.join(".local").join("bin").join(if cfg!(windows) { "claude.exe" } else { "claude" });
        if local_bin.exists() {
            return Some(local_bin);
        }
    }

    // Windows: check npm global path under %APPDATA%
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npm_cmd = PathBuf::from(&appdata).join("npm").join("claude.cmd");
            if npm_cmd.exists() {
                return Some(npm_cmd);
            }
            let npm_exe = PathBuf::from(&appdata).join("npm").join("claude.exe");
            if npm_exe.exists() {
                return Some(npm_exe);
            }
        }
    }

    // Fall back to searching PATH
    if let Ok(path_var) = std::env::var("PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        let exe_name = if cfg!(windows) { "claude.exe" } else { "claude" };
        for dir in path_var.split(separator) {
            let candidate = PathBuf::from(dir).join(exe_name);
            if candidate.exists() {
                return Some(candidate);
            }
            #[cfg(windows)]
            {
                let candidate_cmd = PathBuf::from(dir).join("claude.cmd");
                if candidate_cmd.exists() {
                    return Some(candidate_cmd);
                }
            }
        }
    }

    None
}

/// Returns the path to ~/.claude, honoring CLAUDE_CONFIG_DIR the same way the
/// CLI does — otherwise a user who sets it would have the CLI writing one
/// place while every reader here looked in another.
pub fn claude_home() -> PathBuf {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        let dir = PathBuf::from(dir);
        if !dir.as_os_str().is_empty() {
            return dir;
        }
    }
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".claude")
}

/// The private Claude config home for a gateway-routed panel.
///
/// `/model` inside the CLI saves the chosen model as the user's default for
/// every new session, so one routed panel picking an OpenRouter model used to
/// leave `model: "openrouter/free"` in the shared ~/.claude/settings.json —
/// breaking every other panel, and plain `claude` in a terminal. Routed panels
/// get their own config home (CLAUDE_CONFIG_DIR) so that write stays local to
/// the gateway it belongs to.
pub fn routed_home(key: &str) -> PathBuf {
    crate::app_paths::data_dir()
        .join("claude-config")
        .join(sanitize_key(key))
}

/// Directory names are derived from user-supplied gateway/URL strings, so keep
/// them to a flat, path-safe token.
fn sanitize_key(key: &str) -> String {
    let cleaned: String = key
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() { "gateway".to_string() } else { trimmed }
}

/// Every routed config home Tessera has created, newest first is irrelevant —
/// order only decides which duplicate a lookup finds first, and session ids
/// are unique across all of them.
pub fn routed_homes() -> Vec<PathBuf> {
    let root = crate::app_paths::data_dir().join("claude-config");
    let mut homes: Vec<PathBuf> = match std::fs::read_dir(&root) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect(),
        Err(_) => Vec::new(),
    };
    homes.sort();
    homes
}

/// The shared config home first, then the routed ones. Readers walk all of
/// them so a routed panel's transcripts still appear in the session list,
/// history and usage totals.
pub fn claude_homes() -> Vec<PathBuf> {
    let mut homes = vec![claude_home()];
    for home in routed_homes() {
        if !homes.contains(&home) {
            homes.push(home);
        }
    }
    homes
}

/// Returns the path to ~/.claude/history.jsonl
pub fn history_jsonl_path() -> PathBuf {
    claude_home().join("history.jsonl")
}

/// Every history.jsonl, shared and routed.
pub fn history_jsonl_paths() -> Vec<PathBuf> {
    claude_homes().into_iter().map(|h| h.join("history.jsonl")).collect()
}

/// Returns the path to ~/.claude/projects/
pub fn projects_dir() -> PathBuf {
    claude_home().join("projects")
}

/// Every projects/ directory, shared and routed.
pub fn projects_dirs() -> Vec<PathBuf> {
    claude_homes().into_iter().map(|h| h.join("projects")).collect()
}

/// Encode a project path for use as a directory name.
/// Replaces non-alphanumeric characters with '-'.
pub fn encode_project_path(path: &str) -> String {
    // The CLI encodes with the ASCII regex /[^a-zA-Z0-9]/g -> "-". Rust's
    // char::is_alphanumeric() is Unicode-aware, so it KEEPS letters like the
    // Turkish 'ı' that the CLI replaces — the two then disagree and every
    // resume/history lookup for a non-ASCII path misses the file the CLI
    // actually wrote. Match the CLI byte for byte.
    let encoded: String = path
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();

    // The CLI also caps long names at 200 chars + "-" + a hash of the rest.
    // We can't reproduce its exact hash, so only the <=200 case is guaranteed
    // to match; longer paths were already unsupported (no cap at all before).
    encoded
}

/// The on-disk project directory for an encoded name, tolerating case
/// differences. Windows resolves `C:\Works` and `c:\Works` to the same
/// directory, but the CLI encodes whatever case its cwd happened to carry —
/// both `C--Works-…` and `c--Works-…` exist side by side in practice, and an
/// exact-only match loses whichever one the caller didn't guess.
pub fn find_project_dir(encoded: &str) -> Option<PathBuf> {
    for root in projects_dirs() {
        if let Some(dir) = find_project_dir_in(&root, encoded) { return Some(dir); }
    }
    None
}

/// Writers must use the target CLI's config home. A matching project in a
/// different home is readable by Tessera, but cannot be resumed by that CLI.
pub fn find_project_dir_in(root: &std::path::Path, encoded: &str) -> Option<PathBuf> {
    let exact = root.join(encoded);
    if exact.is_dir() { return Some(exact); }
    for entry in std::fs::read_dir(root).ok()?.flatten() {
        if entry.file_name().to_string_lossy().eq_ignore_ascii_case(encoded) && entry.path().is_dir() {
            return Some(entry.path());
        }
    }
    None
}

/// Returns the path to a session's transcript, looking in:
/// 1. ~/.claude/projects/{encoded_project}/ (or a case variant of it),
/// 2. failing that, every project directory — session ids are UUIDs, so a
///    hit elsewhere is the same session filed under a project string we can't
///    reproduce (case drift, the CLI's >200-char hash cap, moved projects).
/// If the transcript exists anywhere at depth 1, this finds it; otherwise the
/// exact-encoded path is returned so existence checks and error messages
/// still point at the canonical location.
pub fn session_file_path(project_path: &str, session_id: &str) -> PathBuf {
    let encoded = encode_project_path(project_path);
    let file_name = format!("{}.jsonl", session_id);

    if let Some(dir) = find_project_dir(&encoded) {
        let candidate = dir.join(&file_name);
        if candidate.exists() {
            return candidate;
        }
    }

    if !session_id.is_empty() {
        for root in projects_dirs() {
            let Ok(entries) = std::fs::read_dir(root) else { continue };
            for entry in entries.flatten() {
                let candidate = entry.path().join(&file_name);
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }

    projects_dir().join(encoded).join(file_name)
}

/// Resolve a possibly-empty or relative cwd to an absolute path string.
/// Empty and "." fall back to the user's home directory — a desktop app's
/// process current_dir is meaningless to the user, and `encode_project_path(".")`
/// would produce a bogus "-" project key.
pub fn resolve_work_dir(cwd: &str) -> String {
    let trimmed = cwd.trim();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    if trimmed.is_empty() || trimmed == "." {
        return home.to_string_lossy().to_string();
    }
    // Strip trailing separators: the CLI encodes process.cwd() (already
    // normalized), so a hand-typed "C:\proj\\" must not encode to
    // "C--proj-" when the CLI wrote "C--proj".
    let trimmed = trimmed.trim_end_matches(|c| c == '/' || c == char::from(92u8));
    let p = PathBuf::from(trimmed);
    if p.is_absolute() {
        trimmed.to_string()
    } else {
        home.join(p).to_string_lossy().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_project_path() {
        assert_eq!(
            encode_project_path(r"C:\Users\foo\project"),
            "C--Users-foo-project"
        );
        assert_eq!(
            encode_project_path("/home/user/project"),
            "-home-user-project"
        );
    }
}
