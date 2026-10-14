//! First-party apps use the same package validator, native WebView and SDK as
//! downloaded apps. No privileged iframe or legacy bridge is involved.
use super::*;
use sha2::{Digest, Sha256};

pub const SAMPLES: &[&str] = &["notes", "timer", "clock", "calculator", "memory"];
pub fn sample(sample: &str) -> Result<Package, String> {
    macro_rules! files { ($name:literal) => { (include_bytes!(concat!("../../../examples/html-apps/",$name,"/manifest.json")).as_slice(), include_bytes!(concat!("../../../examples/html-apps/",$name,"/index.html")).as_slice()) }; }
    let (manifest, html) = match sample {
        "notes" => files!("notes"), "timer" => files!("timer"), "clock" => files!("clock"),
        "calculator" => files!("calculator"), "memory" => files!("memory"),
        _ => return Err("Unknown example app".into()),
    };
    package::validate(BTreeMap::from([("manifest.json".into(),manifest.to_vec()),("index.html".into(),html.to_vec())]))
}

pub fn provision(app: &tauri::AppHandle, inner: &mut Inner) -> Result<(), String> {
    let mut catalog=inner.installed.clone(); let mut changed=false;
    for id in SAMPLES {
        let package=sample(id)?; let plugin=name(&package.manifest);
        // Only update our bundled revisions or the exact original Quick Notes
        // example. Never replace a user's own imported app on startup.
        let old=catalog.get(&plugin);
        let original_notes=old.is_some_and(|i| ["cff453b9c6da5212e7162cba875aa3db9e1859574601c57e5573ae707ce32fa6","a0362156c6185c4f24829bf98b2a44a025fdf89e86efd701fd80ae39d300dc62"].contains(&i.digest.as_str()));
        if old.is_some_and(|i| (!i.bundled && !original_notes) || i.digest==package.digest) { continue; }
        let mut installed=write_package(app,&package,Grants::default())?;
        installed.bundled=true; installed.enabled=old.map(|i|i.enabled).unwrap_or(true);
        catalog.insert(plugin,installed); changed=true;
    }
    if changed { atomic_json(&root(app)?.join("installed.json"),&catalog)?; inner.installed=catalog; }
    Ok(())
}

/// Deterministic IDs and durable markers make retries/restarts safe. Source
/// localStorage is retained; all notebooks (including closed panels) migrate.
pub fn merge_notes(store: &mut BTreeMap<String,Value>, notebooks: &BTreeMap<String,Value>) -> Result<(),String> {
    for (source,notes) in notebooks {
        if !source.starts_with("plugin-notepad-") || source.len()>200 { return Err("Invalid legacy notebook key".into()); }
        let digest=format!("{:x}",Sha256::digest(source.as_bytes()));
        let marker=format!("app/legacy-import:{digest}");
        if store.contains_key(&marker) { continue; }
        let notes=notes.as_array().ok_or("Invalid legacy notebook")?;
        for (index,note) in notes.iter().enumerate() {
            let title=note["title"].as_str().ok_or("Invalid legacy note title")?;
            let content=note["content"].as_str().ok_or("Invalid legacy note content")?;
            let id=format!("legacy-{:x}",Sha256::digest(format!("{source}/{index}/{}",note["id"]).as_bytes()));
            store.entry(format!("app/note:{id}")).or_insert_with(||json!({"id":id,"title":title,"content":content,"updatedAt":note["updatedAt"].as_u64().unwrap_or(0),"deleted":false}));
        }
        store.insert(marker,json!(true));
    }
    if !store.contains_key("app/quick-notes-migrated") {
        if let Some(content)=store.get("app/notes").and_then(Value::as_str).filter(|s|!s.is_empty()) {
            store.insert("app/note:quick-notes-v1".into(),json!({"id":"quick-notes-v1","title":"Quick Notes","content":content,"updatedAt":0,"deleted":false}));
        }
        store.insert("app/quick-notes-migrated".into(),json!(true));
    }
    if store.len()>2000 || serde_json::to_vec(store).map_err(|e|e.to_string())?.len()>4*1024*1024 { return Err("Your notebooks exceed the app storage limit. The original notes have been kept.".into()); }
    Ok(())
}

#[tauri::command]
pub async fn html_plugin_migrate_notes(caller:Webview,app:tauri::AppHandle,state:tauri::State<'_,HtmlPlugins>,notebooks:BTreeMap<String,Value>) -> Result<(),String> {
    main_only(&caller)?;
    if notebooks.len()>512 || serde_json::to_vec(&notebooks).map_err(|e|e.to_string())?.len()>4*1024*1024 {return Err("Legacy notebooks are too large; originals have been kept".into());}
    let mut inner=state.0.lock().map_err(|e|e.to_string())?;ensure_loaded(&app,&mut inner)?;
    let path=root(&app)?.join("data/html-tessera.quick-notes/storage.json");
    if path.exists() && std::fs::metadata(&path).map_err(|e|e.to_string())?.len()>4*1024*1024 { return Err("Existing app storage exceeds its limit; originals have been kept".into()); }
    let mut store:BTreeMap<String,Value>=if path.exists(){serde_json::from_slice(&std::fs::read(&path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?}else{BTreeMap::new()};
    let before=store.clone();merge_notes(&mut store,&notebooks)?;
    if store!=before { atomic_json(&path,&store)?; }
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn all_bundled_apps_use_unprivileged_packages(){for id in SAMPLES{let p=sample(id).unwrap();assert!(p.manifest.permissions.network.is_empty());assert!(p.manifest.permissions.panels.is_empty());}}
    #[test] fn migrates_every_notebook_and_preserves_edits_on_retry(){
        let mut store=BTreeMap::from([("app/notes".into(),json!("existing Quick Notes"))]);
        let books=BTreeMap::from([("plugin-notepad-one".into(),json!([{"id":"same","title":"First","content":"keep\nthis","updatedAt":2}])),("plugin-notepad-closed".into(),json!([{"id":"same","title":"Second","content":"also keep","updatedAt":3}]))]);
        merge_notes(&mut store,&books).unwrap();assert_eq!(store.keys().filter(|k|k.starts_with("app/note:")).count(),3);
        let key=store.keys().find(|k|k.starts_with("app/note:legacy")).unwrap().clone();store.get_mut(&key).unwrap()["content"]=json!("new edit");
        let before=store.clone();merge_notes(&mut store,&books).unwrap();assert_eq!(before,store);assert_eq!(store["app/notes"],"existing Quick Notes");
    }
}
