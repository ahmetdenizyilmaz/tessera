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

/// Returns the path to ~/.claude
pub fn claude_home() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".claude")
}

/// Returns the path to ~/.claude/history.jsonl
pub fn history_jsonl_path() -> PathBuf {
    claude_home().join("history.jsonl")
}

/// Returns the path to ~/.claude/projects/
pub fn projects_dir() -> PathBuf {
    claude_home().join("projects")
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

/// Returns the path to a session file:
/// ~/.claude/projects/{encoded_project}/{session_id}.jsonl
pub fn session_file_path(project_path: &str, session_id: &str) -> PathBuf {
    let encoded = encode_project_path(project_path);
    projects_dir().join(encoded).join(format!("{}.jsonl", session_id))
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
            encode_project_path("C:\\Users\\foo\\project"),
            "C--Users-foo-project"
        );
        assert_eq!(
            encode_project_path("/home/user/project"),
            "-home-user-project"
        );
    }
}
