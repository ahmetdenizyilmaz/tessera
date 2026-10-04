//! Open a file or folder that an agent mentioned in a chat.
//!
//! Agents write paths three ways: absolute, relative to the panel's working
//! folder, or shortened to something under the Desktop or the home folder.
//! Rather than guess which, try each base in a fixed order and open the first
//! candidate that exists. Folders open in the file manager; files are revealed
//! (selected) in their folder, so a click never launches an arbitrary program.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedPath {
    pub path: String,
    pub is_dir: bool,
    /// Which base resolved it: "absolute" | "cwd" | "desktop" | "home" | "drive".
    pub base: String,
}

fn clean(raw: &str) -> String {
    let mut s = raw.trim().trim_matches(|c| matches!(c, '"' | '\'' | '`' | '<' | '>' | '(' | ')' | '[' | ']' | ',' | ';')).to_string();
    // "file.rs:12:3" and "file.rs#L12" point at a line, not a different file.
    if let Some(idx) = s.rfind('#') { if s[idx + 1..].starts_with('L') { s.truncate(idx); } }
    loop {
        let Some(idx) = s.rfind(':') else { break };
        if idx > 1 && s[idx + 1..].chars().all(|c| c.is_ascii_digit()) && !s[idx + 1..].is_empty() { s.truncate(idx); } else { break; }
    }
    s.trim_end_matches(['/', '\\']).to_string()
}

fn expand_home(s: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home?;
    if s == "~" { return Some(home.to_path_buf()); }
    s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")).map(|rest| home.join(rest))
}

/// The places a written path may refer to, in the order they are tried.
pub fn candidates(raw: &str, cwd: Option<&Path>, home: Option<&Path>, drives: &[PathBuf]) -> Vec<(String, PathBuf)> {
    let s = clean(raw);
    if s.is_empty() { return vec![]; }
    let mut out: Vec<(String, PathBuf)> = vec![];
    let mut push = |base: &str, p: PathBuf| { if !out.iter().any(|(_, q)| *q == p) { out.push((base.into(), p)); } };
    if let Some(p) = expand_home(&s, home) { push("home", p); return out; }
    let path = Path::new(&s);
    if path.is_absolute() || s.starts_with('\\') || s.starts_with('/') {
        push("absolute", path.to_path_buf());
        // "/Users/ady/x" or "\Desktop\x" written without a drive letter.
        let rel = s.trim_start_matches(['/', '\\']);
        for drive in drives { push("drive", drive.join(rel)); }
        return out;
    }
    // Relative: agents shorten to the panel folder, then to the Desktop, then home.
    if let Some(cwd) = cwd { push("cwd", cwd.join(&s)); }
    if let Some(home) = home {
        push("desktop", home.join("Desktop").join(&s));
        // "Desktop/claude_folder/x" and "claude_folder/x" are both common.
        if let Some(rest) = s.strip_prefix("Desktop/").or_else(|| s.strip_prefix("Desktop\\")) { push("desktop", home.join("Desktop").join(rest)); }
        push("home", home.join(&s));
    }
    for drive in drives { push("drive", drive.join(&s)); }
    out
}

fn drive_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        ('C'..='Z').map(|d| PathBuf::from(format!("{d}:\\"))).filter(|p| p.exists()).collect()
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from("/")]
    }
}

pub fn resolve(raw: &str, cwd: Option<&Path>) -> Option<OpenedPath> {
    let home = dirs::home_dir();
    let drives = drive_roots();
    candidates(raw, cwd, home.as_deref(), &drives).into_iter().find_map(|(base, p)| {
        let meta = std::fs::metadata(&p).ok()?;
        Some(OpenedPath { path: p.to_string_lossy().into_owned(), is_dir: meta.is_dir(), base })
    })
}

fn show(target: &OpenedPath) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = std::process::Command::new("explorer.exe");
        if target.is_dir { cmd.arg(&target.path); } else { cmd.arg(format!("/select,{}", target.path)); }
        cmd.creation_flags(CREATE_NO_WINDOW).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if !target.is_dir { cmd.arg("-R"); }
        cmd.arg(&target.path).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let folder = if target.is_dir { PathBuf::from(&target.path) } else { Path::new(&target.path).parent().map(Path::to_path_buf).unwrap_or_default() };
        std::process::Command::new("xdg-open").arg(folder).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Open the first existing match for `path` in the file manager. `cwd` is the
/// panel's working folder. Returns what was opened, or `None` when nothing matched.
#[tauri::command]
pub fn open_path_smart(path: String, cwd: Option<String>) -> Result<Option<OpenedPath>, String> {
    let Some(target) = resolve(&path, cwd.as_deref().map(Path::new)) else { return Ok(None) };
    show(&target)?;
    Ok(Some(target))
}

/// Resolve without opening, for showing which paths in a message exist.
#[tauri::command]
pub fn resolve_path_smart(path: String, cwd: Option<String>) -> Option<OpenedPath> {
    resolve(&path, cwd.as_deref().map(Path::new))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_quotes_line_numbers_and_trailing_separators() {
        assert_eq!(clean("`src/lib/office.ts:12:3`"), "src/lib/office.ts");
        assert_eq!(clean("\"C:\\Users\\ady\\Desktop\\\""), "C:\\Users\\ady\\Desktop");
        assert_eq!(clean("(README.md#L4)"), "README.md");
        assert_eq!(clean("C:\\x\\y"), "C:\\x\\y", "a drive colon is not a line number");
    }

    #[test]
    fn tries_cwd_then_desktop_then_home_then_drives_for_relative_paths() {
        let cwd = PathBuf::from("C:\\work\\proj"); let home = PathBuf::from("C:\\Users\\ady"); let drives = vec![PathBuf::from("C:\\"), PathBuf::from("D:\\")];
        let bases: Vec<String> = candidates("claude_folder/app", Some(&cwd), Some(&home), &drives).into_iter().map(|(b, _)| b).collect();
        assert_eq!(bases, ["cwd", "desktop", "home", "drive", "drive"]);
        let desktop = candidates("Desktop/claude_folder", Some(&cwd), Some(&home), &drives);
        assert!(desktop.iter().any(|(_, p)| *p == home.join("Desktop").join("claude_folder")), "Desktop-prefixed paths are not doubled");
    }

    #[test]
    fn absolute_and_home_paths_are_taken_as_written() {
        let home = PathBuf::from("C:\\Users\\ady");
        let abs = candidates("C:\\Users\\ady\\Desktop", None, Some(&home), &[]);
        assert_eq!(abs[0], ("absolute".to_string(), PathBuf::from("C:\\Users\\ady\\Desktop")));
        let tilde = candidates("~/Desktop/x", None, Some(&home), &[]);
        assert_eq!(tilde, vec![("home".to_string(), home.join("Desktop/x"))]);
        let rootless = candidates("/Users/ady/x", None, Some(&home), &[PathBuf::from("C:\\")]);
        assert!(rootless.iter().any(|(b, p)| b == "drive" && *p == PathBuf::from("C:\\").join("Users/ady/x")));
    }

    #[test]
    fn resolves_against_the_real_filesystem() {
        let dir = std::env::temp_dir().join(format!("tessera-open-path-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("inner")).unwrap();
        std::fs::write(dir.join("inner").join("note.md"), "x").unwrap();
        let hit = resolve("inner/note.md:7", Some(&dir)).expect("relative to cwd");
        assert_eq!((hit.is_dir, hit.base.as_str()), (false, "cwd"));
        let folder = resolve(&dir.join("inner").to_string_lossy(), None).expect("absolute folder");
        assert!(folder.is_dir);
        assert!(resolve("definitely/not/here", Some(&dir)).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
