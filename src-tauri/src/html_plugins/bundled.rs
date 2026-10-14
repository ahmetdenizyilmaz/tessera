//! Bundled apps use the same package validator, native WebView and SDK as
//! downloaded apps. No privileged iframe or legacy bridge is involved.
use super::*;
use sha2::{Digest, Sha256};

pub const SAMPLES: &[&str] = &["notes", "timer", "clock", "calculator", "memory", "music", "menja", "onoff", "radius-raid", "2048", "tetris", "breakout"];
pub fn sample(sample: &str) -> Result<Package, String> {
    macro_rules! files {
        ($name:literal $(, $asset:literal)*) => { BTreeMap::from([
            ("manifest.json".into(), include_bytes!(concat!("../../../examples/html-apps/", $name, "/manifest.json")).to_vec()),
            ("index.html".into(), include_bytes!(concat!("../../../examples/html-apps/", $name, "/index.html")).to_vec()),
            $(($asset.into(), include_bytes!(concat!("../../../examples/html-apps/", $name, "/", $asset)).to_vec()),)*
        ]) };
    }
    let assets = match sample {
        "notes" => files!("notes"), "timer" => files!("timer"), "clock" => files!("clock"),
        "calculator" => files!("calculator"), "memory" => files!("memory"),
        "music" => files!("music"),
        "2048" => files!("2048", "panel.css", "panel.js", "style/main.css", "LICENSE.txt", "UPSTREAM.json",
            "js/keyboard_input_manager.js", "js/html_actuator.js", "js/grid.js", "js/tile.js", "js/local_storage_manager.js", "js/game_manager.js"),
        "tetris" => files!("tetris", "panel.css", "panel.js", "game.js", "LICENSE.txt", "UPSTREAM.json"),
        "breakout" => files!("breakout", "panel.css", "panel.js", "game.js", "breakout.js", "levels.js", "LICENSE.txt", "UPSTREAM.json"),
        "menja" => files!("menja",
            "LICENSE.txt", "README.txt", "UPSTREAM.json", "css/style.css",
            "js/3dModels.js", "js/Entity.js", "js/actions.js", "js/canvas.js",
            "js/createBurst.js", "js/draw.js", "js/getTarget.js", "js/globalConfig.js",
            "js/hud.js", "js/index.js", "js/interaction.js", "js/menus.js",
            "js/sparks.js", "js/state.js", "js/tick.js", "js/utils.js",
            "panel.css", "panel.js"),
        "onoff" => files!("onoff",
            "LICENSE.txt", "README.txt", "TinyMusic-LICENSE.txt", "UPSTREAM.json",
            "index.js", "panel.css", "panel.js", "src/bar.js",
            "src/body.js", "src/counter.js", "src/create.js", "src/dimensions.js",
            "src/goal.js", "src/guy.js", "src/keys.js", "src/levels.js",
            "src/sleep.js", "src/sound.js", "src/spikes.js", "src/tinymusic.js",
            "styles.css"),
        "radius-raid" => files!("radius-raid",
            "Howler-LICENSE.txt", "LICENSE.txt", "README.txt", "UPSTREAM.json",
            "js/audio.js", "js/bullet.js", "js/button.js", "js/definitions.js",
            "js/ease.js", "js/enemy.js", "js/explosion.js", "js/game.js",
            "js/hero.js", "js/howler.min.js", "js/levelpop.js", "js/particle.js",
            "js/particleemitter.js", "js/powerup.js", "js/storage.js", "js/text.js",
            "js/textpop.js", "js/util.js", "panel.css", "panel.js",
            "sounds/click-0.mp3", "sounds/click-0.webm", "sounds/death-0.mp3", "sounds/death-0.webm",
            "sounds/explosion-0.mp3", "sounds/explosion-0.webm", "sounds/explosion-1.mp3", "sounds/explosion-1.webm",
            "sounds/explosionAlt-0.mp3", "sounds/explosionAlt-0.webm", "sounds/hit-0.mp3", "sounds/hit-0.webm",
            "sounds/hit-1.mp3", "sounds/hit-1.webm", "sounds/hit-2.mp3", "sounds/hit-2.webm",
            "sounds/hover-0.mp3", "sounds/hover-0.webm", "sounds/levelup-0.mp3", "sounds/levelup-0.webm",
            "sounds/powerup-0.mp3", "sounds/powerup-0.webm", "sounds/shoot-0.mp3", "sounds/shoot-0.webm",
            "sounds/shootAlt-0.mp3", "sounds/shootAlt-0.webm", "sounds/takingDamage-0.mp3", "sounds/takingDamage-0.webm",
            "sounds/takingDamage-1.mp3", "sounds/takingDamage-1.webm", "sounds/takingDamage-2.mp3", "sounds/takingDamage-2.webm"),
        _ => return Err("Unknown example app".into()),
    };
    package::validate(assets)
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
    #[test] fn bundled_games_include_the_entire_offline_package_and_original_license() {
        for id in ["2048", "tetris", "breakout", "menja", "onoff", "radius-raid"] {
            let bundled = sample(id).unwrap();
            let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/html-apps").join(id);
            let imported = package::inspect(&folder).unwrap();
            assert_eq!(bundled.digest, imported.digest, "Missing embedded assets for {id}");
            assert!(bundled.manifest.permissions.media.is_empty());
            let license = std::str::from_utf8(&bundled.files["LICENSE.txt"]).unwrap();
            assert!(license.contains(if id == "menja" { "GNU GENERAL PUBLIC LICENSE" } else { "Permission is hereby granted" }));
            let source: Value = serde_json::from_slice(&bundled.files["UPSTREAM.json"]).unwrap();
            assert_eq!(source["license"], if id == "menja" { "GPL-3.0-only" } else { "MIT" });
            assert_eq!(source["commit"].as_str().unwrap().len(), 40);
            let html = std::str::from_utf8(&bundled.files["index.html"]).unwrap();
            for attr in ["src=\"", "href=\""] {
                for suffix in html.split(attr).skip(1) {
                    let path = suffix.split('"').next().unwrap();
                    assert!(bundled.files.contains_key(path), "{id} references missing or remote asset {path}");
                }
            }
        }
    }
    #[test] fn migrates_every_notebook_and_preserves_edits_on_retry(){
        let mut store=BTreeMap::from([("app/notes".into(),json!("existing Quick Notes"))]);
        let books=BTreeMap::from([("plugin-notepad-one".into(),json!([{"id":"same","title":"First","content":"keep\nthis","updatedAt":2}])),("plugin-notepad-closed".into(),json!([{"id":"same","title":"Second","content":"also keep","updatedAt":3}]))]);
        merge_notes(&mut store,&books).unwrap();assert_eq!(store.keys().filter(|k|k.starts_with("app/note:")).count(),3);
        let key=store.keys().find(|k|k.starts_with("app/note:legacy")).unwrap().clone();store.get_mut(&key).unwrap()["content"]=json!("new edit");
        let before=store.clone();merge_notes(&mut store,&books).unwrap();assert_eq!(before,store);assert_eq!(store["app/notes"],"existing Quick Notes");
    }
}
