use std::path::Path;

/// Validate that a file path is safe for .ady file operations:
/// - Must have `.ady` extension
/// - Must not contain null bytes
/// - Must not contain `..` path components (path traversal)
fn validate_ady_path(path: &str) -> Result<(), String> {
    // Reject null bytes
    if path.contains('\0') {
        return Err("Path must not contain null bytes".to_string());
    }

    let file_path = Path::new(path);

    // Require .ady extension
    match file_path.extension().and_then(|e| e.to_str()) {
        Some("ady") => {}
        _ => return Err("File must have .ady extension".to_string()),
    }

    // Reject path traversal via `..` components
    for component in file_path.components() {
        if let std::path::Component::ParentDir = component {
            return Err("Path must not contain '..' components".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn session_save_ady(path: String, content: String) -> Result<(), String> {
    validate_ady_path(&path)?;

    let file_path = Path::new(&path);

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    std::fs::write(&file_path, &content)
        .map_err(|e| format!("Failed to write .ady file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn session_load_ady(path: String) -> Result<String, String> {
    validate_ady_path(&path)?;

    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read .ady file: {}", e))
}
