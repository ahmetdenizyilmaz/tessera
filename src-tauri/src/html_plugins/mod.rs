//! Local HTML applications. The host owns installation, identities and grants.
//! An app WebView can invoke only html_plugin_call; it never receives a panel
//! bearer token, a filesystem path, or the host's general Tauri capabilities.
pub mod package;
pub mod network;
pub mod runtime;
pub mod bundled;
pub mod catalog;
pub use runtime::{receive, can_receive, panel_info};

use std::{collections::{BTreeMap, HashMap, VecDeque}, path::{Path, PathBuf}, sync::Mutex, time::{Duration, Instant}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, Webview};
use package::{Manifest, Package};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase", deny_unknown_fields)]
pub struct Grants { pub network: Vec<String>, pub panels: Vec<String>, pub targets: Vec<String> }

impl Grants {
    pub fn validate(&self, manifest: &Manifest) -> Result<(), String> {
        if self.network.len() > 16 || self.panels.len() > 4 || self.targets.len() > 100
            || self.network.iter().any(|o| !manifest.permissions.network.contains(o))
            || self.panels.iter().any(|p| !manifest.permissions.panels.contains(p))
            || self.targets.iter().any(|t| t.is_empty() || t.len() > 160) { return Err("Grants must be a subset of the plugin's requested permissions".into()); }
        Ok(())
    }
    pub fn allows(&self, action: &str, target: &str) -> bool { self.panels.iter().any(|p| p == action) && self.targets.iter().any(|p| p == target) }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Installed { pub manifest: Manifest, pub revision: String, pub digest: String, pub grants: Grants, pub enabled: bool, #[serde(default)] pub bundled: bool }

pub struct Preview { pub package: Package, pub created: Instant }
pub struct Session {
    pub plugin: String, pub panel: String, pub revision: String,
    pub inbox: VecDeque<Value>, pub rate: Instant, pub calls: usize, pub sends: usize,
    pub network: usize,
}

#[derive(Default)]
pub struct Inner {
    pub loaded: bool, pub installed: BTreeMap<String, Installed>, pub previews: HashMap<String, Preview>,
    pub sessions: HashMap<String, Session>,
    pub catalogs: HashMap<String, catalog::Snapshot>,
}
#[derive(Default)]
pub struct HtmlPlugins(pub Mutex<Inner>);

pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> { Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("html-plugins")) }
pub fn name(manifest: &Manifest) -> String { format!("html-{}", manifest.id) }
pub fn main_only(view: &Webview) -> Result<(), String> { if view.label() == "main" { Ok(()) } else { Err("Only Tessera can manage installed apps".into()) } }

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("Missing storage directory")?).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, path).map_err(|e| e.to_string())
}

pub fn ensure_loaded(app: &tauri::AppHandle, inner: &mut Inner) -> Result<(), String> {
    if inner.loaded { return Ok(()); }
    let file = root(app)?.join("installed.json");
    if file.exists() {
        let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 { return Err("Plugin catalog is too large".into()); }
        let saved: BTreeMap<String, Installed> = serde_json::from_slice(&bytes).map_err(|e| format!("Could not read plugin catalog: {e}"))?;
        for (key, app) in saved {
            if package::valid_id(&app.manifest.id) && key == name(&app.manifest) && uuid::Uuid::parse_str(&app.revision).is_ok()
                && app.grants.validate(&app.manifest).is_ok() && package::asset_path(&app.manifest.entry).is_ok() { inner.installed.insert(key, app); }
        }
    }
    bundled::provision(app, inner)?;
    inner.loaded = true; Ok(())
}

pub fn frontend(installed: &Installed) -> Value {
    let m = &installed.manifest; let name = name(m);
    json!({ "name":name, "version":m.version, "description":m.description, "entry":m.entry, "icon":m.icon, "defaultTitle":m.name,
        "htmlPlugin":true, "bundled":installed.bundled, "browserSite":name, "permissions":m.permissions, "enabled":installed.enabled })
}

#[tauri::command]
pub async fn scan_plugins(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, HtmlPlugins>) -> Result<Vec<Value>, String> {
    main_only(&caller)?;
    let mut inner = state.0.lock().map_err(|e| e.to_string())?; ensure_loaded(&app, &mut inner)?;
    Ok(inner.installed.iter().map(|(name, installed)| json!({"name":name,"manifest":frontend(installed)})).collect())
}

#[tauri::command]
pub async fn html_plugin_inspect(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, HtmlPlugins>, path: String) -> Result<Value, String> {
    main_only(&caller)?;
    let package = tokio::task::spawn_blocking(move || package::inspect(Path::new(&path))).await.map_err(|e| e.to_string())??;
    preview_package(&app, &state, package)
}

fn preview_package(app: &tauri::AppHandle, state: &HtmlPlugins, package: Package) -> Result<Value, String> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?; ensure_loaded(&app, &mut inner)?;
    inner.previews.retain(|_, p| p.created.elapsed() < Duration::from_secs(600));
    if inner.previews.len() >= 4 { inner.previews.clear(); }
    let ticket = uuid::Uuid::new_v4().to_string(); let plugin = name(&package.manifest);
    let info = json!({"ticket":ticket,"manifest":package.manifest,"pluginName":plugin,"fileCount":package.files.len(),"bytes":package.files.values().map(Vec::len).sum::<usize>(),"replaces":inner.installed.get(&plugin).map(|p| &p.manifest.version)});
    inner.previews.insert(ticket, Preview { package, created: Instant::now() }); Ok(info)
}

#[tauri::command]
pub async fn html_plugin_sample(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, HtmlPlugins>, sample: String) -> Result<Value, String> {
    main_only(&caller)?;
    let package = bundled::sample(&sample)?;
    preview_package(&app,&state,package)
}

#[tauri::command]
pub async fn html_plugin_install(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, HtmlPlugins>, ticket: String, grants: Grants) -> Result<Value, String> {
    main_only(&caller)?;
    let mut inner = state.0.lock().map_err(|e| e.to_string())?; ensure_loaded(&app, &mut inner)?;
    let preview = inner.previews.get(&ticket).ok_or("Choose the package again; the preview expired")?;
    if preview.created.elapsed() > Duration::from_secs(600) { return Err("Choose the package again; the preview expired".into()); }
    grants.validate(&preview.package.manifest)?;
    let plugin = name(&preview.package.manifest);
    if inner.sessions.values().any(|s| s.plugin == plugin) { return Err("Close this app's panels before updating it".into()); }
    if inner.installed.len() >= 128 && !inner.installed.contains_key(&plugin) { return Err("The local app limit is 128".into()); }
    let installed = write_package(&app, &preview.package, grants)?;
    let mut catalog = inner.installed.clone(); catalog.insert(plugin, installed.clone());
    atomic_json(&root(&app)?.join("installed.json"), &catalog)?;
    inner.installed = catalog; inner.previews.remove(&ticket);
    Ok(frontend(&installed))
}

fn write_package(app: &tauri::AppHandle, package: &Package, grants: Grants) -> Result<Installed,String> {
    let revision=uuid::Uuid::new_v4().to_string();
    let folder=root(app)?.join("packages").join(name(&package.manifest)).join(&revision);
    for (name,bytes) in &package.files {
        let target=folder.join(package::asset_path(name)?);
        std::fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
        std::fs::write(target,bytes).map_err(|e|e.to_string())?;
    }
    Ok(Installed {manifest:package.manifest.clone(),digest:package.digest.clone(),revision,grants,enabled:true,bundled:false})
}

#[tauri::command]
pub async fn html_plugin_permissions(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, HtmlPlugins>, plugin: String, grants: Option<Grants>) -> Result<Grants, String> {
    main_only(&caller)?;
    let mut inner = state.0.lock().map_err(|e| e.to_string())?; ensure_loaded(&app, &mut inner)?;
    let installed = inner.installed.get(&plugin).ok_or("Plugin is not installed")?;
    let Some(grants) = grants else { return Ok(installed.grants.clone()); };
    grants.validate(&installed.manifest)?;
    let mut catalog = inner.installed.clone(); catalog.get_mut(&plugin).unwrap().grants = grants.clone();
    atomic_json(&root(&app)?.join("installed.json"), &catalog)?; inner.installed = catalog;
    // Revocation also clears queued messages, preventing old reads after a grant changes.
    for s in inner.sessions.values_mut().filter(|s| s.plugin == plugin) { s.inbox.clear(); }
    Ok(grants)
}

#[tauri::command]
pub async fn html_plugin_set_enabled(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, HtmlPlugins>, plugin: String, enabled: bool) -> Result<(), String> {
    main_only(&caller)?;
    let mut inner = state.0.lock().map_err(|e| e.to_string())?; ensure_loaded(&app, &mut inner)?;
    let mut catalog = inner.installed.clone(); catalog.get_mut(&plugin).ok_or("Plugin is not installed")?.enabled = enabled;
    atomic_json(&root(&app)?.join("installed.json"), &catalog)?; inner.installed = catalog; Ok(())
}

#[tauri::command]
pub async fn html_plugin_remap_targets(caller: Webview, app: tauri::AppHandle, state: tauri::State<'_, HtmlPlugins>, mapping: HashMap<String,String>) -> Result<(), String> {
    main_only(&caller)?;
    if mapping.len() > 1000 || mapping.iter().any(|(a,b)| a.is_empty() || b.is_empty() || a.len() > 160 || b.len() > 160) { return Err("Invalid restored panel mapping".into()); }
    let mut inner=state.0.lock().map_err(|e|e.to_string())?; ensure_loaded(&app,&mut inner)?;
    let mut catalog=inner.installed.clone(); let mut changed=false;
    for installed in catalog.values_mut() {
        let before=installed.grants.targets.clone();
        installed.grants.targets=before.iter().map(|id| mapping.get(id).unwrap_or(id).clone()).collect();
        changed |= before != installed.grants.targets;
    }
    if changed {
        atomic_json(&root(&app)?.join("installed.json"),&catalog)?;inner.installed=catalog;
        for session in inner.sessions.values_mut() { session.inbox.clear(); }
    }
    Ok(())
}

#[tauri::command]
pub async fn html_plugin_targets(caller: Webview, app: tauri::AppHandle) -> Result<Value, String> {
    main_only(&caller)?;
    let list = app.state::<crate::panelbus::PanelBus>().with_registry(|r| r.all().into_iter().filter(|p| p.kind != "html-plugin" && p.remote_device_id.is_none()).map(|p| json!({"id":p.id,"name":p.name,"provider":p.provider})).collect::<Vec<_>>());
    Ok(json!(list))
}

/// Called only by the trusted browser-panel creation command. Register before
/// navigation starts, so the initialization script can immediately call ready.
pub fn prepare(app: &tauri::AppHandle, panel: &str, plugin: &str) -> Result<(tauri::Url, PathBuf), String> {
    let state = app.state::<HtmlPlugins>(); let mut inner = state.0.lock().map_err(|e| e.to_string())?; ensure_loaded(app, &mut inner)?;
    let installed = inner.installed.get(plugin).filter(|p| p.enabled).ok_or("HTML app is not installed or has been removed")?.clone();
    let label = format!("browser-{panel}");
    inner.sessions.insert(label, Session { plugin: plugin.into(), panel: panel.into(), revision: installed.revision.clone(), inbox: VecDeque::new(), rate: Instant::now(), calls:0, sends:0, network:0 });
    let mut url: tauri::Url = "tessera-plugin://localhost/".parse().unwrap();
    url.set_path(&format!("{}/{}/{}", plugin, installed.revision, installed.manifest.entry));
    let profile = root(app)?.join("profiles").join(plugin);
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    let info = panel_info(panel, &installed);
    drop(inner);
    app.state::<crate::panelbus::PanelBus>().upsert_html_panel(info);
    Ok((url,profile))
}

pub fn closed(app: &tauri::AppHandle, panel: &str) {
    app.state::<HtmlPlugins>().0.lock().unwrap_or_else(|e| e.into_inner()).sessions.remove(&format!("browser-{panel}"));
    app.state::<crate::panelbus::PanelBus>().remove_html_panel(panel);
}

pub fn navigation_allowed(url: &tauri::Url, home: &tauri::Url) -> bool {
    let local = (url.scheme() == "tessera-plugin" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tessera-plugin.localhost"));
    let prefix = home.path().split('/').take(3).collect::<Vec<_>>().join("/") + "/";
    local && url.username().is_empty() && url.password().is_none() && url.port().is_none() && url.path().starts_with(&prefix)
}

pub const SDK: &str = include_str!("sdk.js");

/// Keep asset I/O off the UI thread, with a bounded queue even for a faulty app.
pub fn serve(app: tauri::AppHandle, label: String, request: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    static SLOTS: std::sync::OnceLock<std::sync::Arc<tokio::sync::Semaphore>> = std::sync::OnceLock::new();
    let slots = SLOTS.get_or_init(|| std::sync::Arc::new(tokio::sync::Semaphore::new(32))).clone();
    let Ok(permit) = slots.try_acquire_owned() else {
        responder.respond(tauri::http::Response::builder().status(429).body(b"Too many app asset requests".to_vec()).unwrap());
        return;
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        responder.respond(protocol(&app, &label, request));
    });
}

pub fn protocol(app: &tauri::AppHandle, label: &str, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let result = (|| -> Result<(Vec<u8>, &'static str), String> {
        if request.method() != "GET" { return Err("GET required".into()); }
        let url = tauri::Url::parse(&request.uri().to_string()).map_err(|_| "Invalid URL")?;
        let state = app.state::<HtmlPlugins>(); let inner = state.0.lock().map_err(|e| e.to_string())?;
        let session = inner.sessions.get(label).ok_or("No plugin session")?;
        let installed = inner.installed.get(&session.plugin).filter(|i| i.enabled).ok_or("Plugin disabled")?;
        let prefix = format!("/{}/{}/", session.plugin, session.revision);
        let relative = url.path().strip_prefix(&prefix).ok_or("Wrong plugin origin")?;
        // URL paths arrive percent-encoded. Only decode UTF-8 path characters;
        // validate AFTER decoding, including encoded slashes/traversal.
        let decoded = decode_path(relative)?; let safe = package::asset_path(&decoded)?;
        let base = root(app)?.join("packages").join(&session.plugin).join(&session.revision).canonicalize().map_err(|e| e.to_string())?;
        let path = base.join(safe).canonicalize().map_err(|e| e.to_string())?;
        if !path.starts_with(&base) { return Err("Asset outside package".into()); }
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.len() > package::MAX_FILE { return Err("Invalid asset".into()); }
        let _ = installed;
        Ok((std::fs::read(path).map_err(|e| e.to_string())?, package::mime(&decoded)))
    })();
    let (status, data, mime) = match result { Ok((data,mime)) => (200,data,mime), Err(_) => (403,b"Plugin asset unavailable".to_vec(),"text/plain") };
    // No remote code, frames, workers, forms, direct networking or downloads.
    // Inline scripts/styles keep single-file games/calculators easy to author.
    tauri::http::Response::builder().status(status).header("Content-Type",mime).header("X-Content-Type-Options","nosniff")
        .header("Cache-Control","no-store").header("Access-Control-Allow-Origin","*")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; frame-ancestors 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'")
        .header("X-DNS-Prefetch-Control", "off")
        .header("Permissions-Policy","camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()")
        .body(data).unwrap()
}

fn decode_path(value: &str) -> Result<String, String> {
    let mut bytes = Vec::new(); let mut input = value.as_bytes().iter();
    while let Some(byte) = input.next() {
        if *byte == b'%' { let a = input.next().and_then(|v| (*v as char).to_digit(16)).ok_or("Invalid URL encoding")?; let b = input.next().and_then(|v| (*v as char).to_digit(16)).ok_or("Invalid URL encoding")?; bytes.push((a*16+b) as u8); }
        else { bytes.push(*byte); }
    }
    String::from_utf8(bytes).map_err(|_| "Asset path must be UTF-8".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn permission_grants_are_optional_and_scoped() {
        let manifest:Manifest=serde_json::from_value(json!({"id":"test.app","name":"Test","version":"1","permissions":{"panels":["list","send"],"network":["https://api.example.com"]}})).unwrap();
        assert!(Grants::default().validate(&manifest).is_ok());
        let mut grants=Grants {panels:vec!["send".into()],targets:vec!["chosen".into()],network:vec![]};
        assert!(grants.validate(&manifest).is_ok());assert!(grants.allows("send","chosen"));assert!(!grants.allows("read","chosen"));assert!(!grants.allows("send","another"));
        grants.panels.push("read".into());assert!(grants.validate(&manifest).is_err());
        grants.panels.clear();grants.network.push("https://evil.example".into());assert!(grants.validate(&manifest).is_err());
    }
    #[test] fn navigation_stays_in_its_installed_revision() {
        let home="tessera-plugin://localhost/html-test.app/revision/index.html".parse().unwrap();
        for url in ["tessera-plugin://localhost/html-test.app/revision/help.html","http://tessera-plugin.localhost/html-test.app/revision/index.html"] {assert!(navigation_allowed(&url.parse().unwrap(),&home));}
        for url in ["https://evil.example/?notes=secret","https://tauri.localhost","http://tessera-plugin.localhost/html-other/revision/index.html","tessera-plugin://localhost/html-test.app/other/index.html","tessera-plugin://localhost/html-test.app/revision/../secret","file:///C:/secret","data:text/html,escape"] {assert!(!navigation_allowed(&url.parse().unwrap(),&home),"{url}");}
        assert!(package::asset_path(&decode_path("%2e%2e/secret").unwrap()).is_err());
        assert!(package::asset_path(&decode_path("C%3a/secret").unwrap()).is_err());
    }
    #[test] fn durable_json_replaces_previous_data() {
        let root=std::env::temp_dir().join(format!("tessera-storage-test-{}",uuid::Uuid::new_v4()));let path=root.join("storage.json");
        atomic_json(&path,&json!({"note":"first"})).unwrap();atomic_json(&path,&json!({"note":"second"})).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&std::fs::read(&path).unwrap()).unwrap()["note"],"second");
        std::fs::remove_dir_all(root).unwrap();
    }
}
