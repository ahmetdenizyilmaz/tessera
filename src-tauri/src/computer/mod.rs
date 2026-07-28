use base64::Engine;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotInfo {
    pub width: u32,
    pub height: u32,
    pub data_url: String,
}

#[tauri::command]
pub async fn computer_screenshot() -> Result<ScreenshotInfo, String> {
    let screens = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    let screen = screens
        .first()
        .ok_or_else(|| "No monitors found".to_string())?;

    let image = screen
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {}", e))?;

    let width = image.width();
    let height = image.height();

    // Encode as JPEG
    let mut jpeg_buf: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut jpeg_buf);

    let dynamic_img = image::DynamicImage::ImageRgba8(image);
    dynamic_img
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode screenshot: {}", e))?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg_buf);
    let data_url = format!("data:image/jpeg;base64,{}", b64);

    Ok(ScreenshotInfo {
        width,
        height,
        data_url,
    })
}

#[tauri::command]
pub async fn computer_mouse_move(x: i32, y: i32) -> Result<(), String> {
    use enigo::{Enigo, Mouse, Settings};

    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Failed to init enigo: {}", e))?;

    enigo
        .move_mouse(x, y, enigo::Coordinate::Abs)
        .map_err(|e| format!("Mouse move failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn computer_mouse_click(button: String) -> Result<(), String> {
    use enigo::{Button, Direction, Enigo, Mouse, Settings};

    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Failed to init enigo: {}", e))?;

    let btn = match button.as_str() {
        "right" => Button::Right,
        "middle" => Button::Middle,
        _ => Button::Left,
    };

    enigo
        .button(btn, Direction::Click)
        .map_err(|e| format!("Mouse click failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn computer_key_type(text: String) -> Result<(), String> {
    use enigo::{Enigo, Keyboard, Settings};

    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("Failed to init enigo: {}", e))?;

    enigo
        .text(&text)
        .map_err(|e| format!("Key type failed: {}", e))?;

    Ok(())
}

/// Handle screenshot:// URI protocol requests.
/// Called during Tauri builder setup via register_uri_scheme_protocol.
pub fn handle_screenshot_protocol(
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let uri = request.uri().to_string();

    // Parse monitor index from URI: screenshot://monitor/{index}
    let _monitor_index: usize = uri
        .split('/')
        .last()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    match capture_monitor_jpeg(_monitor_index) {
        Ok(jpeg_bytes) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", "image/jpeg")
            .header("Cache-Control", "no-cache, no-store, must-revalidate")
            .body(jpeg_bytes)
            .unwrap_or_else(|_| {
                tauri::http::Response::builder()
                    .status(500)
                    .body(Vec::new())
                    .unwrap()
            }),
        Err(_) => tauri::http::Response::builder()
            .status(500)
            .body(Vec::new())
            .unwrap(),
    }
}

fn capture_monitor_jpeg(monitor_index: usize) -> Result<Vec<u8>, String> {
    let screens = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    let screen = screens
        .get(monitor_index)
        .or_else(|| screens.first())
        .ok_or_else(|| "No monitors found".to_string())?;

    let image = screen
        .capture_image()
        .map_err(|e| format!("Screenshot failed: {}", e))?;

    let mut jpeg_buf: Vec<u8> = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut jpeg_buf);

    let dynamic_img = image::DynamicImage::ImageRgba8(image);
    dynamic_img
        .write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| format!("JPEG encode failed: {}", e))?;

    Ok(jpeg_buf)
}
