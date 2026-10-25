//! Open a file or folder that an agent mentioned in a chat.
//!
//! Agents write paths as absolute references, relative to the panel's working
//! folder, prefixed with a project folder name, or shortened to something
//! under the Desktop or the home folder.
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
    /// Which base resolved it: "absolute" | "cwd" | "project" | "desktop" | "home" | "drive".
    pub base: String,
}

fn clean(raw: &str) -> String {
    let mut s = raw.trim().trim_matches(|c| matches!(c, '"' | '\'' | '`' | '<' | '>' | '(' | ')' | '[' | ']' | ',' | ';')).to_string();
    // "file.rs:12:3" and "file.rs#L12" point at a line, not a different file.
    if let Some(idx) = s.rfind('#') { if s[idx + 1..].strip_prefix('L').is_some_and(|line| !line.is_empty() && line.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'L')) { s.truncate(idx); } }
    loop {
        let Some(idx) = s.rfind(':') else { break };
        if idx > 1 && s[idx + 1..].chars().all(|c| c.is_ascii_digit()) && !s[idx + 1..].is_empty() { s.truncate(idx); } else { break; }
    }
    // Keep / and C:\ intact: stripping the final slash changes a root into
    // an empty or drive-relative path.
    while s.ends_with(['/', '\\']) && s.len() > 1 && !(s.len() == 3 && s.as_bytes()[1] == b':') { s.pop(); }
    s
}

fn expand_home(s: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home?;
    if s == "~" { return Some(home.to_path_buf()); }
    s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")).map(|rest| home.join(rest))
}

/// The places a written path may refer to, in the order they are tried.
pub fn candidates(raw: &str, cwd: Option<&Path>, home: Option<&Path>, drives: &[PathBuf]) -> Vec<(String, PathBuf)> {
    if raw.trim().to_ascii_lowercase().starts_with("file:") {
        return tauri::Url::parse(raw.trim()).ok().and_then(|mut url| {
            if url.scheme() != "file" || url.query().is_some() { return None; }
            url.set_fragment(None);
            url.to_file_path().ok()
        }).map(|path| vec![("absolute".into(), path)]).unwrap_or_default();
    }
    let s = clean(raw);
    if s.is_empty() || s.chars().any(char::is_control) || s.contains("://") { return vec![]; }
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
    // Try literal cwd-relative paths first. Agents also include the project
    // name, e.g. "x2test/reports" while cwd is already ".../x2test/src".
    // Match that prefix to a named ancestor instead of duplicating it. This
    // only checks explicit candidates; it never searches unrelated folders.
    if let Some(cwd) = cwd {
        push("cwd", cwd.join(&s));
        if let Some(std::path::Component::Normal(prefix)) = path.components().next() {
            for ancestor in cwd.ancestors() {
                let Some(name) = ancestor.file_name() else { continue };
                #[cfg(windows)]
                let matches = name.to_string_lossy().eq_ignore_ascii_case(&prefix.to_string_lossy());
                #[cfg(not(windows))]
                let matches = name == prefix;
                if matches {
                    if let Some(parent) = ancestor.parent() { push("project", parent.join(&s)); }
                }
            }
        }
    }
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
    let lookup = |text: &str| {
        candidates(text, cwd, home.as_deref(), &drives).into_iter().find_map(|(base, p)| {
            let meta = std::fs::metadata(&p).ok()?;
            let path = p.to_string_lossy().into_owned();
            // Explorer's /select argument needs native Windows separators,
            // including when the agent wrote an absolute path with slashes.
            #[cfg(windows)]
            let path = path.replace('/', "\\");
            Some(OpenedPath { path, is_dir: meta.is_dir(), base })
        })
    };
    lookup(raw).or_else(|| {
        // Some terminal Markdown renderers leave escaped underscores in paths.
        // Check the literal spelling first: \_ can also be a real Windows
        // separator before an underscore-prefixed filename. Never rewrite URLs.
        if !raw.contains("\\_") || raw.contains("://") { return None; }
        lookup(&raw.replace("\\_", "_"))
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
pub async fn open_path_smart(path: String, cwd: Option<String>) -> Result<Option<OpenedPath>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(target) = resolve(&path, cwd.as_deref().map(Path::new)) else { return Ok(None) };
        show(&target)?;
        Ok(Some(target))
    }).await.map_err(|e| e.to_string())?
}

/// Resolve without opening, for showing which paths in a message exist.
#[tauri::command]
pub async fn resolve_path_smart(path: String, cwd: Option<String>) -> Option<OpenedPath> {
    tauri::async_runtime::spawn_blocking(move || resolve(&path, cwd.as_deref().map(Path::new))).await.ok().flatten()
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
        assert_eq!(clean("C:\\"), "C:\\");
        assert_eq!(clean("/"), "/");
        assert_eq!(clean("./"), ".");
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
        std::fs::create_dir_all(dir.join("My Files")).unwrap();
        let url = tauri::Url::from_directory_path(dir.join("My Files")).unwrap();
        let linked = resolve(url.as_str(), None).expect("decoded file URL");
        assert!(linked.is_dir);
        assert_eq!(PathBuf::from(linked.path), dir.join("My Files"));
        assert!(resolve("https://example.com/tmp", Some(&dir)).is_none());
        assert!(resolve("file:///%00", None).is_none());
        assert_eq!(resolve("inner", Some(&dir)).unwrap().base, "cwd");
        let parent = resolve("../inner", Some(&dir.join("My Files"))).unwrap();
        assert!(parent.is_dir);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolves_markdown_escaped_underscores_in_relative_and_absolute_paths() {
        let dir = std::env::temp_dir().join(format!("tessera-escaped-path-{}", uuid::Uuid::new_v4()));
        let docs = dir.join("mate_health_report").join("docs");
        let file = docs.join("JEV_DECISION_TREE.md");
        std::fs::create_dir_all(&docs).unwrap();
        std::fs::write(&file, "test").unwrap();
        let relative = r"mate\_health\_report/docs/JEV\_DECISION\_TREE.md";
        let absolute = format!("{}/{}", dir.to_string_lossy().replace('\\', "/"), relative);
        for raw in [relative, absolute.as_str()] {
            let hit = resolve(raw, Some(&dir)).expect("escaped path resolves to the existing file");
            assert_eq!(PathBuf::from(&hit.path), file);
            assert!(!hit.is_dir);
            #[cfg(windows)]
            assert!(!hit.path.contains('/'), "Explorer receives Windows separators");
        }
        let folder = resolve(r"mate\_health\_report/docs/", Some(&dir)).unwrap();
        assert!(folder.is_dir);
        assert_eq!(PathBuf::from(folder.path), docs);
        assert!(resolve(r"mate\_health\_report/docs/not\_here.md", Some(&dir)).is_none());
        let url = tauri::Url::from_file_path(&file).unwrap();
        assert_eq!(PathBuf::from(resolve(url.as_str(), None).unwrap().path), file);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn literal_underscore_prefixed_windows_paths_take_priority_over_markdown_fallbacks() {
        let dir = std::env::temp_dir().join(format!("tessera-literal-path-{}", uuid::Uuid::new_v4()));
        let literal = dir.join(r"mate\_health\_report\docs\JEV\_DECISION\_TREE.md");
        let unescaped = dir.join(r"mate_health_report\docs\JEV_DECISION_TREE.md");
        for file in [&literal, &unescaped] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, "test").unwrap();
        }
        let raw = r"mate\_health\_report/docs/JEV\_DECISION\_TREE.md";
        assert_eq!(PathBuf::from(resolve(raw, Some(&dir)).unwrap().path), literal);
        let forward = literal.to_string_lossy().replace('\\', "/");
        assert_eq!(PathBuf::from(resolve(&forward, None).unwrap().path), literal);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn resolves_project_prefixed_paths_from_the_project_or_a_nested_working_folder() {
        let dir = std::env::temp_dir().join(format!("tessera-project-path-{}", uuid::Uuid::new_v4()));
        let project = dir.join("x2test");
        let output = project.join("fw_2.2.4x_2.2.5x_wakeups");
        let nested = project.join("src").join("tools");
        std::fs::create_dir_all(&output).unwrap();
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(output.join("site.png"), "test").unwrap();
        for cwd in [&project, &nested] {
            let hit = resolve("x2test/fw_2.2.4x_2.2.5x_wakeups/", Some(cwd)).expect("project-prefixed folder");
            assert_eq!(PathBuf::from(hit.path), output);
            assert!(hit.is_dir);
            assert_eq!(hit.base, "project");
            let file = resolve("x2test/fw_2.2.4x_2.2.5x_wakeups/site.png", Some(cwd)).unwrap();
            assert_eq!(PathBuf::from(file.path), output.join("site.png"));
            assert!(!file.is_dir);
        }
        #[cfg(windows)]
        for raw in [r"x2test\fw_2.2.4x_2.2.5x_wakeups\", r"X2TEST\fw_2.2.4x_2.2.5x_wakeups\"] {
            let hit = resolve(raw, Some(&project)).expect("Windows project-prefixed folder");
            assert_eq!(std::fs::canonicalize(hit.path).unwrap(), std::fs::canonicalize(&output).unwrap());
        }
        assert!(resolve("x2test/definitely-not-here", Some(&nested)).is_none());
        // A real path directly inside the panel folder still takes priority.
        let local = nested.join("x2test").join("fw_2.2.4x_2.2.5x_wakeups");
        std::fs::create_dir_all(&local).unwrap();
        let hit = resolve("x2test/fw_2.2.4x_2.2.5x_wakeups/", Some(&nested)).unwrap();
        assert_eq!(PathBuf::from(hit.path), local);
        assert_eq!(hit.base, "cwd");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn does_not_reinterpret_explicit_relative_or_unrelated_paths_as_project_references() {
        let cwd = PathBuf::from("/workspace/project/src");
        for raw in ["./project/out", "../project/out", "unrelated/out", "/project/out", "~/project/out"] {
            assert!(!candidates(raw, Some(&cwd), Some(Path::new("/home/user")), &[])
                .iter().any(|(base, _)| base == "project"), "{raw}");
        }
    }
}
