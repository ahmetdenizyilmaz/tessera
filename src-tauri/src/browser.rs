//! Native website panels. Remote pages have no Tessera capability or plugin SDK.
use serde::{Deserialize, Serialize};
use tauri::{webview::{NewWindowResponse, WebviewBuilder}, Manager, Webview, WebviewUrl};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct BrowserPanels(tokio::sync::Mutex<()>);

fn authorize(caller: &Webview) -> Result<(), String> {
    if caller.label() == "main" { Ok(()) } else { Err("Only the Tessera UI can control browser panels".into()) }
}

fn label(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Invalid browser panel ID".into());
    }
    Ok(format!("browser-{id}"))
}

fn allowed(url: &tauri::Url) -> bool {
    url.scheme() == "https" && matches!(url.host_str(), Some("lichess.org" | "www.lichess.org"))
        && url.port().is_none() && url.username().is_empty() && url.password().is_none()
}

fn saved_url(url: &tauri::Url) -> String {
    // Never put login redirects, tokens, or account settings into workspace exports.
    if !allowed(url) || ["/login", "/signup", "/auth", "/oauth", "/account"].iter().any(|p| url.path().starts_with(p)) {
        return "https://lichess.org/".into();
    }
    let mut url = url.clone();
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

#[tauri::command]
pub async fn browser_panel_create(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, BrowserPanels>, id: String, site: String, url: Option<String>) -> Result<(), String> {
    authorize(&caller)?;
    let label = label(&id)?;
    if site != "lichess" { return Err("Unknown website module".into()); }
    let _guard = state.0.lock().await;
    if app.get_webview(&label).is_some() { return Ok(()); }
    let url = url.and_then(|u| u.parse::<tauri::Url>().ok()).filter(allowed)
        .unwrap_or_else(|| "https://lichess.org/".parse().unwrap());
    let window = app.get_window("main").ok_or("Main window is unavailable")?;
    let profile = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("browser-profiles").join(&site);
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    let popup_app = app.clone();
    let popup_label = label.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .data_directory(profile)
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(allowed)
        .on_new_window(move |url, _| {
            if allowed(&url) {
                let app = popup_app.clone();
                let label = popup_label.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(view) = app.get_webview(&label) { let _ = view.navigate(url); }
                });
            } else if url.scheme() == "https" {
                let _ = popup_app.shell().open(url.to_string(), None);
            }
            NewWindowResponse::Deny
        });
    // Start offscreen; the renderer supplies measured bounds after creation.
    let view = window.add_child(builder, tauri::LogicalPosition::new(-10000.0, -10000.0), tauri::LogicalSize::new(1.0, 1.0))
        .map_err(|e| e.to_string())?;
    view.hide().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct BrowserBounds { x: f64, y: f64, width: f64, height: f64, scale: f64 }

impl BrowserBounds {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height, self.scale].iter().all(|n| n.is_finite())
            && self.x >= 0.0 && self.y >= 0.0 && self.width >= 1.0 && self.height >= 1.0
            && self.width <= 20000.0 && self.height <= 20000.0 && self.scale > 0.0 && self.scale <= 8.0
    }
}

#[tauri::command]
pub async fn browser_panel_bounds(caller: Webview, app: tauri::AppHandle, id: String, bounds: Option<BrowserBounds>) -> Result<(), String> {
    authorize(&caller)?;
    let Some(view) = app.get_webview(&label(&id)?) else { return Ok(()); };
    match bounds {
        Some(b) if b.valid() => {
            view.set_bounds(tauri::Rect {
                position: tauri::PhysicalPosition::new((b.x * b.scale).round() as i32, (b.y * b.scale).round() as i32).into(),
                size: tauri::PhysicalSize::new((b.width * b.scale).round() as u32, (b.height * b.scale).round() as u32).into(),
            }).map_err(|e| e.to_string())?;
            view.show().map_err(|e| e.to_string())
        }
        _ => view.hide().map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn browser_panel_action(caller: Webview, app: tauri::AppHandle, id: String, action: String) -> Result<(), String> {
    authorize(&caller)?;
    let view = app.get_webview(&label(&id)?).ok_or("Browser panel is not ready")?;
    let result = match action.as_str() {
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "reload" => view.reload(),
        "home" => view.navigate("https://lichess.org/".parse().unwrap()),
        "external" => {
            let url = view.url().map_err(|e| e.to_string())?;
            if !allowed(&url) { return Err("Unsupported address".into()); }
            return app.shell().open(url.to_string(), None).map_err(|e| e.to_string());
        }
        _ => return Err("Unknown browser action".into()),
    };
    result.map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct BrowserStatus { url: String }

#[tauri::command]
pub async fn browser_panel_status(caller: Webview, app: tauri::AppHandle, id: String) -> Result<BrowserStatus, String> {
    authorize(&caller)?;
    let view = app.get_webview(&label(&id)?).ok_or("Browser panel is not ready")?;
    Ok(BrowserStatus { url: saved_url(&view.url().map_err(|e| e.to_string())?) })
}

#[tauri::command]
pub async fn browser_panel_close(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, BrowserPanels>, id: String) -> Result<(), String> {
    authorize(&caller)?;
    let _guard = state.0.lock().await;
    if let Some(view) = app.get_webview(&label(&id)?) { view.close().map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn website_boundary_and_restore_addresses() {
        for url in ["https://lichess.org/", "https://lichess.org/abcdefgh/white"] { assert!(allowed(&url.parse().unwrap())); }
        for url in ["http://lichess.org", "https://lichess.org.evil.test/", "https://evil.test/?lichess.org", "https://user@lichess.org/", "file:///C:/secret", "https://lichess.org:8443/"] {
            assert!(!allowed(&url.parse().unwrap()), "{url}");
        }
        assert_eq!(saved_url(&"https://lichess.org/login?token=secret".parse().unwrap()), "https://lichess.org/");
        assert_eq!(saved_url(&"https://lichess.org/abcdefgh?foo=bar#secret".parse().unwrap()), "https://lichess.org/abcdefgh");
        assert!(label("../main").is_err());
        assert!(label("plugin-lichess-123").is_ok());
    }
}
