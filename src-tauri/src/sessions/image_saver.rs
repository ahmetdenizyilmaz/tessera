use std::path::PathBuf;
use std::io::Read;
use base64::Engine;

const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

/// Read a native file-picker selection without granting general filesystem
/// permissions to the webview. Bound the read even if the file grows midway.
#[tauri::command]
pub async fn read_chat_image(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open image: {e}"))?;
        let mut bytes = Vec::new();
        file.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes)
            .map_err(|e| format!("Cannot read image: {e}"))?;
        image_data_url(&bytes)
    }).await.map_err(|e| e.to_string())?
}

fn image_data_url(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("Attach image files up to 10 MB each.".into());
    }
    let mime = match image::guess_format(bytes) {
        Ok(image::ImageFormat::Png) => "image/png",
        Ok(image::ImageFormat::Jpeg) => "image/jpeg",
        Ok(image::ImageFormat::Gif) => "image/gif",
        Ok(image::ImageFormat::WebP) => "image/webp",
        _ => return Err("Choose a PNG, JPEG, GIF, or WebP image.".into()),
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

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

    let images_dir = PathBuf::from(&project_dir).join(".tessera-images");

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_format_comes_from_content_not_filename() {
        let png = b"\x89PNG\r\n\x1a\nimage payload";
        let url = image_data_url(png).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(url.split_once(',').unwrap().1).unwrap(), png);
    }

    #[test]
    fn rejects_non_images_and_oversized_attachments() {
        assert!(image_data_url(b"not an image").is_err());
        assert!(image_data_url(&vec![0; MAX_IMAGE_BYTES as usize + 1]).unwrap_err().contains("10 MB"));
    }
}
