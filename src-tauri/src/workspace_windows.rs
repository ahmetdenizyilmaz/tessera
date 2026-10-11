//! Detached workspaces share their opener's renderer state through DOM portals.
//! These windows contain local UI only; websites remain isolated child views.
use serde::{Deserialize, Serialize};
use tauri::{webview::NewWindowResponse, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn create_main(app: &tauri::App) -> tauri::Result<()> {
    let config = &app.config().app.windows[0];
    let handle = app.handle().clone();
    WebviewWindowBuilder::from_config(app, config)?
        .on_new_window(move |url, features| {
            let Some(main) = handle.get_webview("main") else { return NewWindowResponse::Deny; };
            let Ok(origin) = main.url() else { return NewWindowResponse::Deny; };
            if url.origin() != origin.origin() || url.path() != "/detached.html" { return NewWindowResponse::Deny; }
            let Some(id) = url.query_pairs().find(|(k, _)| k == "id").map(|(_, v)| v.into_owned()) else { return NewWindowResponse::Deny; };
            if uuid::Uuid::parse_str(&id).is_err() { return NewWindowResponse::Deny; }
            let label = format!("workspace-{id}");
            let expected_origin = origin.origin();
            match WebviewWindowBuilder::new(&handle, label, WebviewUrl::External("about:blank".parse().unwrap()))
                .window_features(features).title("Tessera").inner_size(1100.0, 750.0)
                .min_inner_size(460.0, 300.0).visible(false)
                .on_navigation(move |next| next.as_str() == "about:blank" || (next.origin() == expected_origin && next.path() == "/detached.html"))
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build() {
                    Ok(window) => NewWindowResponse::Create { window },
                    Err(error) => { eprintln!("[workspace-window] {error}"); NewWindowResponse::Deny }
                }
        }).build()?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowBounds { pub x: i32, pub y: i32, pub width: u32, pub height: u32 }

#[derive(Serialize)]
pub struct DropTarget { pub label: Option<String>, pub x: f64, pub y: f64 }

#[cfg(windows)]
fn window_under_pointer(x: f64, y: f64) -> isize {
    #[repr(C)] struct Point { x: i32, y: i32 }
    #[link(name = "user32")]
    extern "system" { fn WindowFromPoint(point: Point) -> isize; fn GetAncestor(window: isize, flags: u32) -> isize; }
    unsafe { GetAncestor(WindowFromPoint(Point { x: x as i32, y: y as i32 }), 2) }
}

#[tauri::command]
pub async fn workspace_drop_target(app: tauri::AppHandle) -> Result<DropTarget, String> {
    let main = app.get_window("main").ok_or("Main window is unavailable")?;
    let cursor = main.cursor_position().map_err(|e| e.to_string())?;
    #[cfg(windows)] let hit = window_under_pointer(cursor.x, cursor.y);
    let mut label = None;
    for (name, window) in app.windows() {
        if name != "main" && !name.starts_with("workspace-") { continue; }
        if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(true) { continue; }
        #[cfg(windows)]
        if window.hwnd().map(|h| h.0 as isize).ok() != Some(hit) { continue; }
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        if cursor.x >= pos.x as f64 && cursor.y >= pos.y as f64 && cursor.x < pos.x as f64 + size.width as f64 && cursor.y < pos.y as f64 + size.height as f64 {
            label = Some(name);
            break;
        }
    }
    Ok(DropTarget { label, x: cursor.x, y: cursor.y })
}

#[tauri::command]
pub async fn workspace_window_place(app: tauri::AppHandle, label: String, bounds: WindowBounds) -> Result<(), String> {
    if !label.starts_with("workspace-") { return Err("Invalid workspace window".into()); }
    let window = app.get_window(&label).ok_or("Workspace window is unavailable")?;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors.iter().find(|m| {
        let p = m.position(); let s = m.size();
        bounds.x >= p.x && bounds.y >= p.y && (bounds.x as i64) < p.x as i64 + s.width as i64 && (bounds.y as i64) < p.y as i64 + s.height as i64
    }).or_else(|| monitors.first()).ok_or("No monitor is available")?;
    let p = monitor.position(); let s = monitor.size();
    let width = bounds.width.clamp(460, s.width.max(460));
    let height = bounds.height.clamp(300, s.height.max(300));
    let x = bounds.x.clamp(p.x, (p.x + s.width as i32 - width as i32).max(p.x));
    let y = bounds.y.clamp(p.y, (p.y + s.height as i32 - height as i32).max(p.y));
    window.set_size(tauri::PhysicalSize::new(width, height)).map_err(|e| e.to_string())?;
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_window_destroy(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if !label.starts_with("workspace-") { return Err("Invalid workspace window".into()); }
    if let Some(window) = app.get_window(&label) {
        if let Some(main) = app.get_window("main") {
            // A tab may have just moved out of the last slot. Preserve its live
            // website until its new DOM surface supplies the destination bounds.
            for view in window.webviews() {
                if view.label().starts_with("browser-") {
                    view.hide().map_err(|e| e.to_string())?;
                    view.reparent(&main).map_err(|e| e.to_string())?;
                }
            }
        }
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}
