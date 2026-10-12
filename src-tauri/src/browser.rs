//! Native website panels. Remote pages have no Tessera capability or plugin SDK.
use serde::{Deserialize, Serialize};
use tauri::{webview::{NewWindowResponse, WebviewBuilder}, Manager, Webview, WebviewUrl};
use tauri_plugin_shell::ShellExt;
use std::collections::HashMap;

#[derive(Default)]
pub struct BrowserPanels(tokio::sync::Mutex<HashMap<String, SitePolicy>>);

#[derive(Clone)]
struct SitePolicy { home: tauri::Url, custom: bool }

impl SitePolicy {
    fn new(site: &str, home: Option<&str>) -> Result<Self,String> {
        if site == "lichess" { return Ok(Self {home:"https://lichess.org/".parse().unwrap(),custom:false}); }
        if !site.starts_with("web-app-") || site.len() <= 8 || label(site).is_err() { return Err("Unknown website module".into()); }
        let home = home.ok_or("A home address is required")?.parse::<tauri::Url>().map_err(|_|"Invalid web address")?;
        if !web_address(&home) {return Err("Only http and https addresses without credentials are supported".into());}
        Ok(Self {home,custom:true})
    }
    fn allows(&self, url: &tauri::Url) -> bool { if self.custom {web_address(url)} else {allowed(url)} }
}

fn web_address(url: &tauri::Url) -> bool {
    matches!(url.scheme(),"https"|"http") && url.host_str().is_some() && url.username().is_empty() && url.password().is_none()
}

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

fn saved_url(url: &tauri::Url, policy: &SitePolicy) -> String {
    // Never put login redirects, tokens, or account settings into workspace exports.
    if !policy.allows(url) || ["/login", "/signin", "/signup", "/auth", "/oauth", "/account"].iter().any(|p| url.path().starts_with(p)) {
        return policy.home.to_string();
    }
    let mut url = url.clone();
    url.set_query(None);
    url.set_fragment(None);
    url.to_string()
}

/// Website keyboard events cannot bubble to the host UI. Handle F11 on the
/// native controller without exposing any Tessera commands to the website.
#[cfg(windows)]
fn install_panel_shortcut(view: &Webview, app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri::Emitter;
    use webview2_com::{AcceleratorKeyPressedEventHandler, Microsoft::Web::WebView2::Win32::{COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS}};
    #[link(name = "user32")]
    extern "system" { fn GetKeyState(key: i32) -> i16; }
    view.with_webview(move |platform| unsafe {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut key = 0;
            args.VirtualKey(&mut key)?;
            if key != 0x7A || [0x10, 0x11, 0x12, 0x5B, 0x5C].iter().any(|key| GetKeyState(*key) < 0) { return Ok(()); }
            args.SetHandled(true)?;
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
            args.KeyEventKind(&mut kind)?;
            let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
            args.PhysicalKeyStatus(&mut status)?;
            if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && !status.WasKeyDown.as_bool() {
                let app = app.clone();
                let id = id.clone();
                // WebView2 holds its input lock during this callback. Deliver
                // the UI event after returning instead of issuing sync IPC.
                tauri::async_runtime::spawn(async move { let _ = app.emit_to("main", "browser-panel-maximize", id); });
            }
            Ok(())
        }));
        if let Err(error) = platform.controller().add_AcceleratorKeyPressed(&handler, &mut 0) {
            eprintln!("Could not install browser panel shortcut: {error}");
        }
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_panel_create(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, BrowserPanels>, id: String, site: String, url: Option<String>, home_url: Option<String>) -> Result<(), String> {
    authorize(&caller)?;
    let label = label(&id)?;
    let policy = SitePolicy::new(&site,home_url.as_deref())?;
    let mut profiles = state.0.lock().await;
    if app.get_webview(&label).is_some() { return Ok(()); }
    let url = url.and_then(|u| u.parse::<tauri::Url>().ok()).filter(|u|policy.allows(u)).unwrap_or_else(||policy.home.clone());
    let window = app.get_window("main").ok_or("Main window is unavailable")?;
    let profile = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("browser-profiles").join(&site);
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    let popup_app = app.clone();
    let popup_label = label.clone();
    let navigation_policy=policy.clone();
    let popup_policy=policy.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .data_directory(profile)
        .focused(false)
        .disable_drag_drop_handler()
        .on_navigation(move |url|navigation_policy.allows(url))
        .on_new_window(move |url, _| {
            if popup_policy.allows(&url) {
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
    #[cfg(windows)]
    install_panel_shortcut(&view, app.clone(), id)?;
    profiles.insert(label,policy);
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
pub async fn browser_panel_bounds(caller: Webview, app: tauri::AppHandle, id: String, bounds: Option<BrowserBounds>, window_label: Option<String>) -> Result<(), String> {
    authorize(&caller)?;
    let Some(view) = app.get_webview(&label(&id)?) else { return Ok(()); };
    match bounds {
        Some(b) if b.valid() => {
            let label = window_label.as_deref().unwrap_or("main");
            if label != "main" && !label.starts_with("workspace-") { return Err("Invalid parent window".into()); }
            if view.window().label() != label {
                let parent = app.get_window(label).ok_or("Parent window is unavailable")?;
                view.hide().map_err(|e| e.to_string())?;
                view.reparent(&parent).map_err(|e| e.to_string())?;
            }
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
pub async fn browser_panel_action(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, BrowserPanels>, id: String, action: String) -> Result<(), String> {
    authorize(&caller)?;
    let view = app.get_webview(&label(&id)?).ok_or("Browser panel is not ready")?;
    let policy=state.0.lock().await.get(&label(&id)?).cloned().ok_or("Website profile is unavailable")?;
    let result = match action.as_str() {
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "reload" => view.reload(),
        "home" => view.navigate(policy.home.clone()),
        "external" => {
            let url = view.url().map_err(|e| e.to_string())?;
            if !policy.allows(&url) { return Err("Unsupported address".into()); }
            return app.shell().open(url.to_string(), None).map_err(|e| e.to_string());
        }
        _ => return Err("Unknown browser action".into()),
    };
    result.map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct BrowserStatus { url: String }

#[tauri::command]
pub async fn browser_panel_status(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, BrowserPanels>, id: String) -> Result<BrowserStatus, String> {
    authorize(&caller)?;
    let view = app.get_webview(&label(&id)?).ok_or("Browser panel is not ready")?;
    let policy=state.0.lock().await.get(&label(&id)?).cloned().ok_or("Website profile is unavailable")?;
    Ok(BrowserStatus { url: saved_url(&view.url().map_err(|e| e.to_string())?, &policy) })
}

#[tauri::command]
pub async fn browser_panel_close(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, BrowserPanels>, id: String) -> Result<(), String> {
    authorize(&caller)?;
    let mut profiles = state.0.lock().await;
    if let Some(view) = app.get_webview(&label(&id)?) { view.close().map_err(|e| e.to_string())?; }
    profiles.remove(&label(&id)?);
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
        let policy=SitePolicy::new("lichess",None).unwrap();
        assert_eq!(saved_url(&"https://lichess.org/login?token=secret".parse().unwrap(), &policy), "https://lichess.org/");
        assert_eq!(saved_url(&"https://lichess.org/abcdefgh?foo=bar#secret".parse().unwrap(), &policy), "https://lichess.org/abcdefgh");
        assert!(label("../main").is_err());
        assert!(label("plugin-lichess-123").is_ok());
    }
    #[test]
    fn custom_web_apps_keep_stable_profiles_and_allow_web_auth_navigation() {
        let policy=SitePolicy::new("web-app-stable-identity",Some("https://player.example.test/")).unwrap();
        for url in ["https://player.example.test/music", "https://login.example.test/oauth", "http://127.0.0.1:4567/"] {assert!(policy.allows(&url.parse().unwrap()));}
        for url in ["file:///C:/secret", "javascript:alert(1)", "data:text/html,hello", "https://user:pass@example.test/"] {assert!(!policy.allows(&url.parse().unwrap()));}
        assert_eq!(saved_url(&"https://login.example.test/oauth?token=secret".parse().unwrap(), &policy),"https://player.example.test/");
        assert_eq!(saved_url(&"https://player.example.test/music?token=secret#fragment".parse().unwrap(), &policy),"https://player.example.test/music");
        assert!(SitePolicy::new("web-app-../../outside",Some("https://example.test/")).is_err());
        assert!(SitePolicy::new("web-app-safe",Some("file:///C:/secret")).is_err());
    }
}
