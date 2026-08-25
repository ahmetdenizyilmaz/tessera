use std::path::Path;

/// Register a local GGUF file as an Ollama model so it shows up in
/// `ollama list` (and our model dropdowns). Writes a one-line Modelfile and
/// shells out to `ollama create` — hashing a multi-GB file takes a while, so
/// the blocking work runs off the async runtime.
#[tauri::command]
pub async fn ollama_import_gguf(gguf_path: String, name: String) -> Result<String, String> {
    let path = Path::new(&gguf_path);
    if !path.is_file() {
        return Err(format!("File not found: {}", gguf_path));
    }
    if !gguf_path.to_lowercase().ends_with(".gguf") {
        return Err("Not a .gguf file".to_string());
    }
    let clean_name: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':') {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    if clean_name.is_empty() {
        return Err("Empty model name".to_string());
    }

    let modelfile = std::env::temp_dir().join(format!("tessera-import-{}.Modelfile", clean_name));
    std::fs::write(&modelfile, format!("FROM {}\n", gguf_path))
        .map_err(|e| format!("Failed to write Modelfile: {}", e))?;

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("ollama");
        cmd.arg("create").arg(&clean_name).arg("-f").arg(&modelfile);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let output = cmd
            .output()
            .map_err(|e| format!("Could not run ollama (is it installed and on PATH?): {}", e))?;
        let _ = std::fs::remove_file(&modelfile);
        if output.status.success() {
            Ok(clean_name)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            Err(format!("ollama create failed: {} {}", stderr.trim(), stdout.trim()))
        }
    })
    .await
    .map_err(|e| format!("Import task failed: {}", e))??;

    Ok(result)
}
