pub use crate::codex::executable::Executable;
use std::path::PathBuf;

fn from_path(path: PathBuf) -> Option<Executable> {
    if !path.is_file() {
        return None;
    }
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    if ["cmd", "bat", "ps1"]
        .iter()
        .any(|e| ext.eq_ignore_ascii_case(e))
    {
        let package = path.parent()?.join("node_modules");
        // Prefer the native npm optional dependency; never execute shell shims.
        for folder in [
            "opencode-windows-x64",
            "opencode-windows-x64-baseline",
            "opencode-ai/node_modules/opencode-windows-x64",
            "opencode-ai/node_modules/opencode-windows-x64-baseline",
        ] {
            let native = package.join(folder).join("bin/opencode.exe");
            if native.is_file() {
                return Some(Executable {
                    program: native,
                    args: vec![],
                });
            }
        }
        let js = package.join("opencode-ai/bin/opencode");
        return js.is_file().then(|| Executable {
            program: PathBuf::from("node"),
            args: vec![js.to_string_lossy().into()],
        });
    }
    Some(Executable {
        program: path,
        args: vec![],
    })
}
pub fn resolve(path: &str) -> Result<Executable, String> {
    if !path.trim().is_empty() {
        return from_path(PathBuf::from(path.trim()))
            .ok_or_else(|| "Choose opencode.exe (or the npm opencode.cmd shim).".into());
    }
    let mut dirs = vec![crate::app_paths::data_dir().join("tools/opencode")];
    if let Some(home) = dirs::home_dir() {
        dirs.extend([
            home.join(".opencode/bin"),
            home.join(".local/bin"),
            home.join("scoop/shims"),
            home.join("AppData/Roaming/npm"),
        ]);
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    for dir in dirs {
        for name in if cfg!(windows) {
            vec!["opencode.exe", "opencode.cmd"]
        } else {
            vec!["opencode"]
        } {
            if let Some(exe) = from_path(dir.join(name)) {
                return Ok(exe);
            }
        }
    }
    Err("OpenCode was not found. Install the OpenCode CLI (npm install -g opencode-ai), or choose its executable in OpenCode settings. Claude Code is not required.".into())
}
