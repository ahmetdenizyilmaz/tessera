use super::*;
use crate::panelbus::{registry::PanelInfo, PanelBus};
use tauri::Emitter;

pub fn panel_info(id: &str, app: &Installed) -> PanelInfo {
    let mut info = PanelInfo::ui_sender();
    info.id = id.into(); info.name = app.manifest.name.clone(); info.kind = "html-plugin".into(); info.provider = Some("html-plugin".into()); info
}

pub fn can_receive(app: &tauri::AppHandle, target: &str, sender: &str) -> bool {
    let state = app.state::<HtmlPlugins>(); let inner = state.0.lock().unwrap_or_else(|e| e.into_inner());
    inner.sessions.get(&format!("browser-{target}")).and_then(|s| inner.installed.get(&s.plugin))
        .is_some_and(|i| i.enabled && i.grants.allows("receive", sender))
}

pub fn receive(app: &tauri::AppHandle, target: &str, sender: &str, sender_name: &str, text: &str, hop: u32) -> Result<Value, String> {
    if text.len() > 16 * 1024 || hop > 8 { return Err("HTML app message size or relay limit exceeded".into()); }
    let state = app.state::<HtmlPlugins>(); let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let label = format!("browser-{target}");
    let plugin = inner.sessions.get(&label).ok_or("HTML app panel is closed")?.plugin.clone();
    let installed = inner.installed.get(&plugin).ok_or("HTML app is not installed")?;
    if !installed.enabled || !installed.grants.allows("receive", sender) { return Err("This HTML app has not allowed messages from that panel".into()); }
    let session = inner.sessions.get_mut(&label).unwrap();
    if session.inbox.len() >= 64 { return Err("HTML app inbox is full; it has not read its messages yet".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    session.inbox.push_back(json!({"id":id,"from":sender,"fromName":sender_name,"message":text,"hop":hop}));
    Ok(json!({"delivered":true,"queued":true,"messageId":id,"waited":false,"note":"Delivered to the HTML app inbox. It can reply asynchronously using Tessera.panels.send; do not resend this message."}))
}

fn authorize(caller: &Webview, app: &tauri::AppHandle, method: &str) -> Result<(String, Installed), String> {
    let url = caller.url().map_err(|e| e.to_string())?;
    let state = app.state::<HtmlPlugins>(); let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let session = inner.sessions.get_mut(caller.label()).ok_or("No HTML app session")?;
    let mut home: tauri::Url = "tessera-plugin://localhost/".parse().unwrap();
    home.set_path(&format!("{}/{}/index.html", session.plugin, session.revision));
    if !navigation_allowed(&url, &home) { return Err("HTML app calls must come from its installed package".into()); }
    if session.rate.elapsed() >= Duration::from_secs(60) { session.rate = Instant::now(); session.calls = 0; session.sends = 0; }
    session.calls += 1;
    if session.calls > 2000 { return Err("HTML app request rate exceeded; retry in a minute".into()); }
    if method == "panels.send" { session.sends += 1; if session.sends > 20 { return Err("HTML apps may send at most 20 panel messages per minute".into()); } }
    let panel = session.panel.clone(); let plugin = session.plugin.clone();
    let installed = inner.installed.get(&plugin).filter(|i| i.enabled).ok_or("HTML app has been removed")?.clone();
    Ok((panel,installed))
}

fn storage_path(app: &tauri::AppHandle, plugin: &str) -> Result<PathBuf, String> { Ok(root(app)?.join("data").join(plugin).join("storage.json")) }
fn storage_call(app: &tauri::AppHandle, installed: &Installed, panel: &str, method: &str, params: Value) -> Result<Value, String> {
    let state = app.state::<HtmlPlugins>();
    // Serialize read/modify/write across all panels of this app.
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let path = storage_path(app, &name(&installed.manifest))?;
    let mut store: BTreeMap<String, Value> = if path.exists() {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > 4 * 1024 * 1024 { return Err("App storage exceeds its 4 MB quota".into()); }
        serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
    } else { BTreeMap::new() };
    let scope = match params["scope"].as_str() { None | Some("app") => "app".to_string(), Some("panel") => format!("panel:{panel}"), _ => return Err("Storage scope must be app or panel".into()) };
    if method == "storage.entries" {
        let prefix=params["prefix"].as_str().unwrap_or("");
        if prefix.len()>128 || prefix.chars().any(char::is_control) {return Err("Invalid storage prefix".into());}
        let scope=format!("{scope}/");
        return Ok(json!(store.iter().filter_map(|(key,value)|key.strip_prefix(&scope).filter(|k|k.starts_with(prefix)).map(|k|(k.to_string(),value.clone()))).collect::<BTreeMap<_,_>>()));
    }
    let key = params["key"].as_str().unwrap_or("");
    if key.is_empty() || key.len() > 128 || key.chars().any(char::is_control) { return Err("Storage key must contain 1 to 128 characters".into()); }
    let key = format!("{scope}/{key}");
    match method {
        "storage.get" => return Ok(store.get(&key).cloned().unwrap_or(Value::Null)),
        "storage.set" => { store.insert(key, params["value"].clone()); },
        "storage.remove" => { store.remove(&key); },
        _ => return Err("Unknown storage method".into()),
    }
    if store.len() > 2000 || serde_json::to_vec(&store).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 { return Err("App storage exceeds its 4 MB / 2000-key quota".into()); }
    atomic_json(&path, &store)?; Ok(Value::Null)
}

#[tauri::command]
pub async fn html_plugin_call(caller: Webview, app: tauri::AppHandle, method: String, params: Value) -> Result<Value, String> {
    if method.len() > 40 || serde_json::to_vec(&params).map_err(|e| e.to_string())?.len() > 1024 * 1024 { return Err("HTML app request is too large".into()); }
    let (panel,installed) = authorize(&caller, &app, &method)?;
    match method.as_str() {
        "ready" => Ok(json!({"instanceId":panel,"pluginName":name(&installed.manifest),"name":installed.manifest.name,"version":installed.manifest.version,"permissions":installed.grants})),
        "media.snapshot" | "media.control" => {
            let permission = if method == "media.snapshot" { "read" } else { "control" };
            if !installed.grants.media.iter().any(|p| p == permission) { return Err(format!("Media {permission} permission is not enabled. Open app permissions to allow it.")); }
            let handle = app.clone(); let label = caller.label().to_owned();
            let plugin = name(&installed.manifest); let revision = installed.revision.clone();
            let check = move || {
                let state = handle.state::<HtmlPlugins>(); let inner = state.0.lock().unwrap_or_else(|e|e.into_inner());
                inner.sessions.get(&label).is_some_and(|s|s.plugin==plugin && s.revision==revision)
                    && inner.installed.get(&plugin).is_some_and(|i|i.enabled && i.grants.media.iter().any(|p|p==permission))
            };
            let result = media::request(&method, params, Box::new(check)).await?;
            let (_, latest) = authorize(&caller, &app, "result")?;
            if !latest.grants.media.iter().any(|p|p==permission) { return Err("Media access was revoked".into()); }
            Ok(result)
        }
        "ui.openPermissions" => {
            let _ = app.emit_to("main", "html-plugin-ui", json!({"id":panel,"openPermissions":true}));
            Ok(Value::Null)
        }
        "storage.get" | "storage.set" | "storage.remove" | "storage.entries" => storage_call(&app, &installed, &panel, &method, params),
        "ui.title" => {
            let title = params["title"].as_str().ok_or("Title is required")?;
            if title.trim().is_empty() || title.len() > 120 || title.chars().any(char::is_control) { return Err("Invalid panel title".into()); }
            let mut info = panel_info(&panel, &installed); info.name = title.into();
            app.state::<PanelBus>().upsert_html_panel(info);
            let _ = app.emit_to("main", "html-plugin-ui", json!({"id":panel,"title":title})); Ok(Value::Null)
        }
        "ui.badge" => {
            let value = &params["count"];
            if !value.is_null() && !value.as_u64().is_some_and(|n| n <= 9999) { return Err("Badge must be null or 0 to 9999".into()); }
            let _ = app.emit_to("main", "html-plugin-ui", json!({"id":panel,"badge":value})); Ok(Value::Null)
        }
        "panels.list" => {
            if !installed.grants.panels.iter().any(|p| p == "list") { return Err("Panel discovery permission is not enabled".into()); }
            let bus = app.state::<PanelBus>();
            Ok(json!(bus.with_registry(|r| r.all().into_iter().filter(|p| installed.grants.targets.contains(&p.id)).map(|p| json!({"id":p.id,"name":p.name,"provider":p.provider,"busy":p.busy,"reachable":p.reachable()})).collect::<Vec<_>>())))
        }
        "panels.read" | "panels.send" => {
            let target = params["panel"].as_str().ok_or("Select a panel id")?;
            let action = if method == "panels.read" { "read" } else { "send" };
            if !installed.grants.allows(action, target) { return Err(format!("The app has not been granted {action} access to this panel")); }
            let bus = app.state::<PanelBus>();
            if bus.next_hop(&panel) > 8 { return Err("HTML app relay limit reached; start a fresh interaction later".into()); }
            let args = if method == "panels.read" { json!({"panel":target,"limit":params["limit"].as_u64().unwrap_or(20).clamp(1,50)}) }
                else {
                    let message = params["message"].as_str().ok_or("Message is required")?;
                    if message.trim().is_empty() || message.len() > 16 * 1024 { return Err("Message must contain 1 to 16384 bytes".into()); }
                    // A waited-for reply is also conversation access.
                    let wait = params["waitForReply"].as_bool().unwrap_or(false);
                    if wait && !installed.grants.allows("read", target) { return Err("Waiting for a reply requires read permission for that panel".into()); }
                    json!({"panel":target,"message":message,"wait_for_reply":wait,"timeout_seconds":params["timeoutSeconds"].as_u64().unwrap_or(60).clamp(1,120)})
                };
            let result = crate::panelbus::tools::call(&app, &panel, if method == "panels.read" {"read_panel"} else {"send_to_panel"}, args).await?;
            // Revoking access while a long request runs must also hide its result.
            let (_, latest) = authorize(&caller, &app, "result")?;
            if !latest.grants.allows(action,target) || (params["waitForReply"].as_bool().unwrap_or(false) && !latest.grants.allows("read",target)) { return Err("Panel access was revoked".into()); }
            if serde_json::to_vec(&result).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 { return Err("Panel result exceeds 2 MB; request fewer messages".into()); }
            Ok(result)
        }
        "panels.poll" => {
            if !installed.grants.panels.iter().any(|p| p == "receive") { return Err("Receiving panel messages is not enabled".into()); }
            let state = app.state::<HtmlPlugins>(); let mut inner = state.0.lock().map_err(|e| e.to_string())?;
            let session = inner.sessions.get_mut(caller.label()).ok_or("App panel is closed")?;
            let messages: Vec<_> = session.inbox.drain(..).filter(|m| m["from"].as_str().is_some_and(|s| installed.grants.targets.iter().any(|t| t == s))).collect();
            Ok(json!(messages))
        }
        "net.fetch" => {
            let request: network::Request = serde_json::from_value(params).map_err(|e| e.to_string())?;
            {
                let state = app.state::<HtmlPlugins>(); let mut inner = state.0.lock().map_err(|e| e.to_string())?;
                let plugin = name(&installed.manifest);
                if inner.sessions.values().filter(|s| s.plugin == plugin).map(|s| s.network).sum::<usize>() >= 3 { return Err("This app already has three network requests running".into()); }
                inner.sessions.get_mut(caller.label()).ok_or("App panel is closed")?.network += 1;
            }
            let result = tokio::time::timeout(Duration::from_secs(30), network::fetch(request, &installed.grants.network)).await.map_err(|_| "Network request timed out".to_string()).and_then(|r| r);
            {
                let state = app.state::<HtmlPlugins>(); let mut inner = state.0.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(s) = inner.sessions.get_mut(caller.label()) { s.network = s.network.saturating_sub(1); }
            }
            let (_, latest) = authorize(&caller, &app, "result")?;
            if latest.grants.network != installed.grants.network { return Err("Network access changed while the request was running".into()); }
            serde_json::to_value(result?).map_err(|e| e.to_string())
        }
        _ => Err("Unknown or unavailable HTML plugin API".into()),
    }
}
