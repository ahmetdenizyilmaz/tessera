use std::path::PathBuf;

#[tauri::command]
pub async fn save_chat_image(
    data: Vec<u8>,
    project_dir: String,
    ext: String,
) -> Result<String, String> {
    // Validate extension: must be alphanumeric only (e.g. png, jpg, gif, webp).
    // Reject anything with path separators, dots, or other special characters.
    if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid image extension: must contain only alphanumeric characters".to_string());
    }

    let images_dir = PathBuf::from(&project_dir).join(".claude-gui-images");

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&images_dir)
        .map_err(|e| format!("Failed to create images directory: {}", e))?;

    // Generate unique filename
    let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let file_path = images_dir.join(&filename);

    // Write image data
    std::fs::write(&file_path, &data)
        .map_err(|e| format!("Failed to write image: {}", e))?;

    Ok(file_path.to_string_lossy().into_owned())
}
