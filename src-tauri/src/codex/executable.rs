use std::path::PathBuf;
use std::process::Command;

#[derive(Clone)]
pub struct Executable {
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl Executable {
    pub fn command(&self) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.args(&self.args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        // Do not accidentally attach to the host agent's execution context.
        for key in [
            "CODEX_THREAD_ID",
            "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
            "CLAUDECODE",
            "CLAUDE_CODE_CHILD_SESSION",
        ] {
            cmd.env_remove(key);
        }
        cmd
    }
}

fn from_path(path: PathBuf) -> Option<Executable> {
    if !path.is_file() {
        return None;
    }
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("cmd")
        || ext.eq_ignore_ascii_case("bat")
        || ext.eq_ignore_ascii_case("ps1")
    {
        // npm's shim is shell code. Resolve its JS entrypoint without a shell.
        let js = path
            .parent()?
            .join("node_modules/@openai/codex/bin/codex.js");
        if js.is_file() {
            return Some(Executable {
                program: PathBuf::from("node"),
                args: vec![js.to_string_lossy().into()],
            });
        }
        return None;
    }
    Some(Executable {
        program: path,
        args: vec![],
    })
}

pub fn resolve(override_path: Option<&str>) -> Result<Executable, String> {
    if let Some(path) = override_path.filter(|p| !p.trim().is_empty()) {
        return from_path(PathBuf::from(path)).ok_or_else(|| {
            "Codex executable path is invalid. Choose codex.exe or the npm codex.cmd shim.".into()
        });
    }
    let mut dirs = vec![];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
        #[cfg(windows)]
        dirs.push(home.join("AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    for dir in dirs {
        for name in if cfg!(windows) {
            vec!["codex.exe", "codex.cmd"]
        } else {
            vec!["codex"]
        } {
            if let Some(exe) = from_path(dir.join(name)) {
                return Ok(exe);
            }
        }
    }
    Err("Codex CLI was not found. Install it with npm install -g @openai/codex, run codex login, then Retry.".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn invalid_override_does_not_fall_back() {
        assert!(super::resolve(Some("Z:/missing-codex-binary.exe")).is_err());
    }
}
