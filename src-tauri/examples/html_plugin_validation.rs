//! Synthetic native HTML-app harness. Separate app profile, no user's agents,
//! database, credentials, or actual MCP listener. Test-only eval/report commands
//! are compiled into this example binary, never into Tessera.
use std::{collections::HashMap, sync::Mutex};
use serde_json::{json, Value};
use tauri::{Manager, Webview};
use tessera_lib::{browser, html_plugins, panelbus, workspace_windows};
#[cfg(windows)] #[path="support/media_fixture.rs"] mod media_fixture;
#[cfg(not(windows))]
mod media_fixture {
    #[derive(Default)] pub struct State;
    #[tauri::command]
    pub fn validation_media(_action:String)->Result<serde_json::Value,String> {Err("Windows media fixture only".into())}
}

#[derive(Default)]
struct Reports(Mutex<HashMap<String, tokio::sync::oneshot::Sender<Value>>>);

#[tauri::command]
fn validation_exit(app:tauri::AppHandle) { app.exit(0); }
#[tauri::command]
fn validation_secret() -> &'static str { "host only" }
#[tauri::command]
fn validation_report(app:tauri::AppHandle, ticket:String, value:Value) {
    if let Some(sender) = app.state::<Reports>().0.lock().unwrap().remove(&ticket) { let _ = sender.send(value); }
}
#[tauri::command]
async fn validation_eval(caller:Webview, app:tauri::AppHandle, id:String, expression:String) -> Result<Value,String> {
    html_plugins::main_only(&caller)?;
    let view=app.get_webview(&format!("browser-{id}")).ok_or("App view missing")?;
    let ticket=uuid::Uuid::new_v4().to_string();let (sender,receiver)=tokio::sync::oneshot::channel();
    app.state::<Reports>().0.lock().unwrap().insert(ticket.clone(),sender);
    view.eval(format!("(async()=>{{try{{const value=await ({expression});await window.__TAURI_INTERNALS__.invoke('validation_report',{{ticket:{},value:{{ok:true,value:value??null}}}});}}catch(e){{await window.__TAURI_INTERNALS__.invoke('validation_report',{{ticket:{},value:{{ok:false,error:String(e)}}}});}}}})()",json!(ticket),json!(ticket))).map_err(|e|e.to_string())?;
    let result=tokio::time::timeout(std::time::Duration::from_secs(12),receiver).await;
    app.state::<Reports>().0.lock().unwrap().remove(&ticket);
    result.map_err(|_|"App probe timed out")?.map_err(|e|e.to_string())
}
#[tauri::command]
fn validation_info(app:tauri::AppHandle,id:String) -> Result<Value,String> {
    let view=app.get_webview(&format!("browser-{id}")).ok_or("App view missing")?;
    Ok(json!({"url":view.url().map_err(|e|e.to_string())?.as_str(),"parent":view.window().label(),"size":view.size().map_err(|e|e.to_string())?}))
}
#[tauri::command]
async fn validation_tool(app:tauri::AppHandle,caller:String,tool:String,args:Value) -> Result<Value,String> {
    panelbus::tools::call(&app,&caller,&tool,args).await
}
#[tauri::command]
fn validation_roster(app:tauri::AppHandle) {
    let mut a=panelbus::registry::PanelInfo::ui_sender();a.id="synthetic-agent".into();a.name="Synthetic Claude".into();a.kind="terminal".into();a.provider=Some("claude".into());
    let mut b=a.clone();b.id="unapproved-agent".into();b.name="Unapproved Claude".into();
    app.state::<panelbus::PanelBus>().replace_panels(vec![a,b]);
}
fn main() {
    let mut context=tauri::generate_context!();
    context.config_mut().identifier="com.tessera.html-plugin-validation".into();
    let window=&mut context.config_mut().app.windows[0];
    window.url=tauri::WebviewUrl::External("http://localhost:1420/tools/html-plugin-fixture.html".parse().unwrap());
    window.title="Tessera HTML app validation (synthetic)".into();window.width=1100.;window.height=800.;window.visible=false;window.maximized=false;window.create=false;
    let handler=tessera_lib::main_view_commands(tauri::generate_handler![
        validation_exit,validation_secret,validation_eval,validation_info,validation_tool,validation_roster,media_fixture::validation_media,
        html_plugins::bundled::html_plugin_migrate_notes,
            html_plugins::catalog::html_catalog_list,html_plugins::catalog::html_catalog_preview,
            html_plugins::scan_plugins,html_plugins::html_plugin_inspect,html_plugins::html_plugin_sample,html_plugins::html_plugin_install,
        html_plugins::html_plugin_permissions,html_plugins::html_plugin_set_enabled,html_plugins::html_plugin_remap_targets,html_plugins::html_plugin_targets,html_plugins::runtime::html_plugin_call,
        browser::browser_panel_appearance, browser::browser_panel_create,browser::browser_panel_bounds,browser::browser_panel_action,browser::browser_panel_status,browser::browser_panel_close,
        workspace_windows::workspace_drop_target,workspace_windows::workspace_window_place,workspace_windows::workspace_window_destroy]);
    let report: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![validation_report]);
    tauri::Builder::default().plugin(tauri_plugin_shell::init()).plugin(tauri_plugin_fs::init()).plugin(tauri_plugin_dialog::init())
        .manage(Reports::default()).manage(browser::BrowserPanels::default()).manage(html_plugins::HtmlPlugins::default())
        .manage(media_fixture::State::default())
        .manage(panelbus::PanelBus::new(Some(1),String::new()))
        .register_asynchronous_uri_scheme_protocol("tessera-plugin",|ctx,req,res|html_plugins::serve(ctx.app_handle().clone(),ctx.webview_label().to_string(),req,res))
        .invoke_handler(move |invoke| {if invoke.message.command()=="validation_report" {report(invoke)} else {handler(invoke)}})
        .setup(|app| {
            workspace_windows::create_main(app)?;
            let handle=app.handle().clone();std::thread::spawn(move||{std::thread::sleep(std::time::Duration::from_secs(240));handle.exit(0);});Ok(())
        }).run(context).expect("HTML plugin validation");
}
