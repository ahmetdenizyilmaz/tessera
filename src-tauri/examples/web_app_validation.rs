//! Isolated cookie-persistence harness. Separate profile; no agent sessions.
#[path = "../src/browser.rs"] mod browser;
#[tauri::command]
fn validation_exit(app:tauri::AppHandle) {app.exit(0);}
fn main() {
    let mut context=tauri::generate_context!();
    context.config_mut().identifier="com.tessera.webapp-validation".into();
    let window=&mut context.config_mut().app.windows[0];
    window.url=tauri::WebviewUrl::External("http://127.0.0.1:1420/tools/web-app-native.html".parse().unwrap());
    window.title="Tessera web app validation (synthetic)".into();
    window.width=900.0;window.height=650.0;window.visible=false;window.maximized=false;window.create=true;
    tauri::Builder::default().plugin(tauri_plugin_shell::init()).manage(browser::BrowserPanels::default())
        .invoke_handler(tauri::generate_handler![validation_exit,browser::browser_panel_create,browser::browser_panel_bounds,browser::browser_panel_action,browser::browser_panel_status,browser::browser_panel_close])
        .setup(|app| {let handle=app.handle().clone();std::thread::spawn(move||{std::thread::sleep(std::time::Duration::from_secs(180));handle.exit(0);});Ok(())})
        .run(context).expect("web app validation");
}
