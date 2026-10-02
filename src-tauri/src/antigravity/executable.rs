pub use crate::codex::executable::Executable;
use std::path::PathBuf;

const NOT_FOUND: &str = "Antigravity CLI (agy) was not found. Install it from https://antigravity.google/docs/cli/install/ (Windows PowerShell: irm https://antigravity.google/cli/install.ps1 | iex), or choose agy.exe in Antigravity settings.";

fn from_path(path: PathBuf) -> Option<Executable> {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    // agy is a native binary. Never run a shell script the user did not pick as one.
    if !path.is_file()
        || ["cmd", "bat", "ps1"]
            .iter()
            .any(|e| ext.eq_ignore_ascii_case(e))
    {
        return None;
    }
    Some(Executable {
        program: path,
        args: vec![],
    })
}

/// The official installer's locations come before PATH: a running Tessera keeps
/// the PATH it started with, so a CLI installed afterwards is otherwise invisible.
fn candidate_dirs() -> Vec<PathBuf> {
    // Component-wise joins keep the path shown in the UI in native separators.
    let mut dirs = vec![crate::app_paths::data_dir().join("tools").join("antigravity")];
    if let Some(local) = dirs::data_local_dir() {
        dirs.push(local.join("agy").join("bin"));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local").join("bin"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs
}

pub fn resolve(path: &str) -> Result<Executable, String> {
    if !path.trim().is_empty() {
        return from_path(PathBuf::from(path.trim())).ok_or_else(|| {
            "The Antigravity executable path is invalid. Choose agy.exe (the native CLI binary)."
                .into()
        });
    }
    let name = if cfg!(windows) { "agy.exe" } else { "agy" };
    candidate_dirs()
        .into_iter()
        .find_map(|dir| from_path(dir.join(name)))
        .ok_or_else(|| NOT_FOUND.into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn invalid_override_does_not_fall_back_and_shell_shims_are_refused() {
        assert!(super::resolve("Z:/missing-agy-binary.exe").is_err());
        let dir = std::env::temp_dir().join(format!("tessera-agy-exe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let shim = dir.join("agy.cmd");
        std::fs::write(&shim, "@echo off").unwrap();
        assert!(super::resolve(&shim.to_string_lossy()).is_err());
        let native = dir.join("agy.exe");
        std::fs::write(&native, "binary").unwrap();
        assert_eq!(
            super::resolve(&native.to_string_lossy()).unwrap().program,
            native
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
