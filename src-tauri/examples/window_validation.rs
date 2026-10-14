//! Isolated native UI harness. Never opens the user's profile or agent sessions.
use tessera_lib::{browser, html_plugins, panelbus, workspace_windows};
fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.tessera.window-validation".into();
    let window = &mut context.config_mut().app.windows[0];
    window.url = tauri::WebviewUrl::External("http://localhost:1420/tools/window-fixture.html?native".parse().unwrap());
    window.title = "Tessera window validation".into();
    window.width = 950.0; window.height = 700.0; window.visible = true; window.create = false;
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(browser::BrowserPanels::default())
        .manage(html_plugins::HtmlPlugins::default()).manage(panelbus::PanelBus::new(None, String::new()))
        .invoke_handler(tauri::generate_handler![workspace_windows::workspace_drop_target, workspace_windows::workspace_window_place, workspace_windows::workspace_window_destroy,
            browser::browser_panel_create, browser::browser_panel_bounds, browser::browser_panel_action, browser::browser_panel_status, browser::browser_panel_close])
        .setup(|app| workspace_windows::create_main(app).map_err(Into::into))
        .run(context).expect("window validation");
}
