//! Optional version-matched terminal renderer. The official CLI still owns the
//! app-server, model execution, permissions, tools and saved conversations.
use super::executable::Executable;
use std::path::PathBuf;

pub async fn renderer(official: &Executable, resource_dir: PathBuf) -> Executable {
    let original = official.clone();
    let fallback = official.clone();
    tokio::task::spawn_blocking(move || {
        let dir = resource_dir.join("codex-terminal");
        let candidate = dir.join("codex.exe");
        if !candidate.is_file() {
            return original;
        }
        let validated = (|| -> Option<Executable> {
            let manifest: serde_json::Value =
                serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).ok()?).ok()?;
            let expected = manifest["cliVersion"].as_str()?;
            let version = original.command().arg("--version").output().ok()?;
            if !version.status.success() || String::from_utf8_lossy(&version.stdout).trim() != expected {
                return None;
            }
            let patched = Executable { program: candidate, args: vec![] };
            let version = patched.command().arg("--version").output().ok()?;
            if !version.status.success() || String::from_utf8_lossy(&version.stdout).trim() != expected {
                return None;
            }
            Some(patched)
        })();
        validated.unwrap_or_else(|| {
            eprintln!("Codex terminal renderer does not match the installed CLI; using the official renderer.");
            original
        })
    })
    .await
    .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn absent_or_incomplete_renderer_keeps_official_command() {
        let dir = std::env::temp_dir().join(format!("tessera-renderer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let official = Executable {
            program: PathBuf::from("official-codex"),
            args: vec!["wrapper.js".into()],
        };
        let selected = renderer(&official, dir.clone()).await;
        assert_eq!(
            (&selected.program, &selected.args),
            (&official.program, &official.args)
        );
        let runtime_dir = dir.join("codex-terminal");
        std::fs::create_dir(&runtime_dir).unwrap();
        std::fs::write(runtime_dir.join("codex.exe"), b"incomplete package").unwrap();
        std::fs::write(runtime_dir.join("manifest.json"), b"invalid manifest").unwrap();
        let selected = renderer(&official, dir.clone()).await;
        assert_eq!(
            (&selected.program, &selected.args),
            (&official.program, &official.args)
        );
        std::fs::remove_file(runtime_dir.join("codex.exe")).unwrap();
        std::fs::remove_file(runtime_dir.join("manifest.json")).unwrap();
        std::fs::remove_dir(runtime_dir).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[tokio::test]
    #[ignore = "Requires TESSERA_TEST_CODEX and a built TESSERA_TEST_RENDERER"]
    async fn live_renderer_requires_matching_cli_versions() {
        let official = Executable {
            program: std::env::var_os("TESSERA_TEST_CODEX").unwrap().into(),
            args: vec![],
        };
        let candidate = PathBuf::from(std::env::var_os("TESSERA_TEST_RENDERER").unwrap());
        let dir = std::env::temp_dir().join(format!("tessera-renderer-{}", uuid::Uuid::new_v4()));
        let runtime_dir = dir.join("codex-terminal");
        std::fs::create_dir_all(&runtime_dir).unwrap();
        let binary = runtime_dir.join("codex.exe");
        std::fs::copy(candidate, &binary).unwrap();
        let version = official.command().arg("--version").output().unwrap();
        assert!(version.status.success());
        let expected = String::from_utf8_lossy(&version.stdout).trim().to_owned();
        let manifest = runtime_dir.join("manifest.json");
        std::fs::write(
            &manifest,
            serde_json::json!({"cliVersion": expected}).to_string(),
        )
        .unwrap();
        assert_eq!(renderer(&official, dir.clone()).await.program, binary);
        std::fs::write(&manifest, br#"{"cliVersion":"codex-cli 0.0.0-mismatch"}"#).unwrap();
        assert_eq!(
            renderer(&official, dir.clone()).await.program,
            official.program
        );
        std::fs::remove_file(binary).unwrap();
        std::fs::remove_file(manifest).unwrap();
        std::fs::remove_dir(runtime_dir).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
