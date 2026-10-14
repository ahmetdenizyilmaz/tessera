//! Validate and snapshot packages before showing an install preview. No code runs here.
use std::{collections::{BTreeMap, HashSet}, io::Read, path::{Path, PathBuf}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use base64::Engine;

pub const MAX_FILE: u64 = 8 * 1024 * 1024;
pub const MAX_PACKAGE: usize = 32 * 1024 * 1024;
pub const MAX_FILES: usize = 512;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Permissions {
    pub network: Vec<String>,
    pub panels: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)] pub description: String,
    #[serde(default = "default_entry")] pub entry: String,
    #[serde(default = "default_icon")] pub icon: String,
    #[serde(default)] pub permissions: Permissions,
}
fn default_entry() -> String { "index.html".into() }
fn default_icon() -> String { "Puzzle".into() }

pub struct Package { pub manifest: Manifest, pub files: BTreeMap<String, Vec<u8>>, pub digest: String }

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.split('.').all(|s| !s.is_empty())
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
        && id.as_bytes()[0].is_ascii_alphanumeric()
}

/// Deliberately use the same portable path rules on every OS. Reject ADS,
/// traversal, symlinks/reparse points, reserved device names and case aliases.
pub fn asset_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.len() > 240 || name.contains(['\\', ':', '\0', '?', '#', '%', '<', '>', '|', '*', '"']) { return Err("Invalid package path".into()); }
    for part in name.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty() || part == "." || part == ".." || part.ends_with(['.', ' ']) || part.chars().any(|c| c.is_control())
            || ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"].contains(&stem.as_str()) {
            return Err("Package contains an unsafe or nonportable filename".into());
        }
    }
    Ok(PathBuf::from(name))
}

pub fn is_link(meta: &std::fs::Metadata) -> bool {
    if meta.file_type().is_symlink() { return true; }
    #[cfg(windows)] { use std::os::windows::fs::MetadataExt; if meta.file_attributes() & 0x400 != 0 { return true; } }
    false
}

fn insert(files: &mut BTreeMap<String, Vec<u8>>, names: &mut HashSet<String>, name: String, mut reader: impl Read) -> Result<(), String> {
    asset_path(&name)?;
    if files.len() >= MAX_FILES || !names.insert(name.to_lowercase()) { return Err("Too many files or duplicate package paths".into()); }
    let mut data = Vec::new();
    reader.by_ref().take(MAX_FILE + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() as u64 > MAX_FILE || data.len() + files.values().map(Vec::len).sum::<usize>() > MAX_PACKAGE { return Err("Plugin exceeds the 8 MB/file or 32 MB/package limit".into()); }
    files.insert(name, data); Ok(())
}

fn read_folder(root: &Path, directory: &Path, files: &mut BTreeMap<String, Vec<u8>>, names: &mut HashSet<String>, depth: usize) -> Result<(), String> {
    if depth > 16 { return Err("Plugin folders may be at most 16 levels deep".into()); }
    for item in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        if names.len() >= MAX_FILES { return Err("Too many package entries".into()); }
        let item = item.map_err(|e| e.to_string())?; let path = item.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if is_link(&meta) { return Err("Links and junctions are not supported in plugins".into()); }
        let name = path.strip_prefix(root).map_err(|e| e.to_string())?.to_str().ok_or("Package paths must be Unicode")?.replace('\\', "/");
        asset_path(&name)?;
        if meta.is_dir() {
            if !names.insert(name.to_lowercase()) { return Err("Duplicate package directory".into()); }
            read_folder(root, &path, files, names, depth + 1)?;
        }
        else if meta.is_file() { insert(files, names, name, std::fs::File::open(path).map_err(|e| e.to_string())?)?; }
        else { return Err("Only regular files are supported".into()); }
    }
    Ok(())
}

pub fn inspect(path: &Path) -> Result<Package, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if is_link(&meta) { return Err("Choose the actual plugin folder or file, not a link".into()); }
    let mut files = BTreeMap::new(); let mut names = HashSet::new();
    if meta.is_dir() { read_folder(path, path, &mut files, &mut names, 0)?; }
    else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
        if meta.len() > MAX_PACKAGE as u64 { return Err("ZIP file is too large".into()); }
        let mut archive = zip::ZipArchive::new(std::fs::File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if archive.len() > MAX_FILES { return Err("ZIP contains too many entries".into()); }
        for index in 0..archive.len() {
            let file = archive.by_index(index).map_err(|e| e.to_string())?;
            let name = file.name().to_string();
            asset_path(name.trim_end_matches('/'))?;
            if file.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err("ZIP symlinks are not supported".into()); }
            if file.is_dir() { continue; }
            insert(&mut files, &mut names, name, file)?;
        }
        // Accept the common ZIP containing one enclosing folder.
        if !files.contains_key("manifest.json") {
            let roots: Vec<_> = files.keys().filter(|n| n.ends_with("/manifest.json")).cloned().collect();
            if roots.len() == 1 {
                let prefix = roots[0].strip_suffix("manifest.json").unwrap();
                if files.keys().all(|n| n.starts_with(prefix)) { files = files.into_iter().map(|(n, d)| (n[prefix.len()..].to_string(), d)).collect(); }
            }
        }
    } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm")) {
        insert(&mut files, &mut names, "index.html".into(), std::fs::File::open(path).map_err(|e| e.to_string())?)?;
        let title = path.file_stem().and_then(|s| s.to_str()).unwrap_or("HTML app").chars().take(60).collect::<String>();
        let identity = format!("local.{}", &format!("{:x}", Sha256::digest(path.canonicalize().map_err(|e| e.to_string())?.to_string_lossy().as_bytes()))[..16]);
        files.insert("manifest.json".into(), serde_json::to_vec(&Manifest { id: identity, name: title, version: "1.0.0".into(), description: "Standalone HTML app".into(), entry: default_entry(), icon: default_icon(), permissions: Permissions::default() }).unwrap());
    } else { return Err("Choose a plugin folder, ZIP, or standalone HTML file".into()); }
    validate(files)
}

pub fn validate(files: BTreeMap<String, Vec<u8>>) -> Result<Package, String> {
    let data = files.get("manifest.json").ok_or("The package needs manifest.json at its root")?;
    if data.len() > 32 * 1024 { return Err("Manifest is too large".into()); }
    let mut manifest: Manifest = serde_json::from_slice(data).map_err(|e| format!("Invalid manifest: {e}"))?;
    if !valid_id(&manifest.id) || manifest.name.trim().is_empty() || manifest.name.len() > 100 || manifest.name.chars().any(char::is_control)
        || manifest.version.is_empty() || manifest.version.len() > 40 || manifest.description.len() > 1000 { return Err("Invalid plugin id, name, version or description".into()); }
    asset_path(&manifest.entry)?;
    if !manifest.entry.ends_with(".html") || !files.contains_key(&manifest.entry) { return Err("Entry must name an HTML file in the package".into()); }
    if manifest.permissions.network.len() > 16 || manifest.permissions.panels.len() > 4 { return Err("Too many requested permissions".into()); }
    manifest.permissions.network = manifest.permissions.network.iter().map(|value| super::network::origin(value)).collect::<Result<Vec<_>,_>>()?;
    manifest.permissions.network.sort(); manifest.permissions.network.dedup();
    manifest.permissions.panels.sort(); manifest.permissions.panels.dedup();
    if manifest.permissions.panels.iter().any(|p| !["list", "read", "send", "receive"].contains(&p.as_str())) { return Err("Unknown panel permission".into()); }
    if let Some(icon) = files.get(&manifest.icon) {
        if icon.len() > 70_000 || !icon.starts_with(b"\x89PNG\r\n\x1a\n") { return Err("Plugin icons must be PNG images smaller than 70 KB".into()); }
        manifest.icon = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(icon));
    } else if !["Puzzle", "Calculator", "FileText", "NotebookPen", "Clock", "Timer", "Gamepad2", "Dice5", "Trophy", "Globe", "Music", "BookOpen", "MessageCircle"].contains(&manifest.icon.as_str()) { return Err("Icon must be a supported icon name or a bundled PNG filename".into()); }
    let mut hash = Sha256::new();
    for (name, bytes) in &files { hash.update((name.len() as u64).to_le_bytes()); hash.update(name); hash.update((bytes.len() as u64).to_le_bytes()); hash.update(bytes); }
    Ok(Package { manifest, files, digest: format!("{:x}", hash.finalize()) })
}

pub fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8", "js" | "mjs" => "text/javascript; charset=utf-8", "css" => "text/css; charset=utf-8",
        "json" => "application/json", "svg" => "image/svg+xml", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", "gif" => "image/gif",
        "woff" => "font/woff", "woff2" => "font/woff2", "ttf" => "font/ttf", "mp3" => "audio/mpeg", "ogg" => "audio/ogg", "wav" => "audio/wav", "mp4" => "video/mp4", "wasm" => "application/wasm", _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn files(manifest: &str) -> BTreeMap<String,Vec<u8>> { BTreeMap::from([("manifest.json".into(),manifest.as_bytes().to_vec()),("index.html".into(),b"<!doctype html><h1>Local</h1>".to_vec())]) }
    const BASIC: &str = r#"{"id":"example.app","name":"Example","version":"1.0.0"}"#;
    #[test] fn basic_apps_need_no_permissions() {
        let package = validate(files(BASIC)).unwrap();
        assert!(package.manifest.permissions.network.is_empty()); assert!(package.manifest.permissions.panels.is_empty());
        assert_eq!(package.manifest.entry,"index.html");
        assert_eq!(package.digest,validate(files(BASIC)).unwrap().digest);
        let mut changed = files(BASIC); changed.insert("index.html".into(),b"different".to_vec());
        assert_ne!(package.digest,validate(changed).unwrap().digest);
    }
    #[test] fn rejects_traversal_devices_and_ambiguous_paths() {
        for path in ["../secret", "/absolute", "C:/secret", "a/../x", "a\\x", "file:stream", "NUL", "aux.txt", "COM1.txt", "a//b", "a/./b", "bad.", "a/%2e%2e/x", "<bad>", "a\0x"] { assert!(asset_path(path).is_err(),"{path}"); }
        for path in ["index.html","assets/game.js","images/my image.png","assets/oyun-şekil.svg"] { assert!(asset_path(path).is_ok(),"{path}"); }
        for id in ["../bad","foo..bar","Foo","x/evil","","-foo"] { assert!(!valid_id(id),"{id}"); }
    }
    #[test] fn validates_permissions_and_entry() {
        let package=validate(files(r#"{"id":"example.app","name":"Example","version":"1","permissions":{"network":["https://example.com/"],"panels":["send","read"]}}"#)).unwrap();
        assert_eq!(package.manifest.permissions.network,vec!["https://example.com"]);
        for manifest in [r#"{"id":"example.app","name":"Example","version":"1","entry":"missing.html"}"#,
            r#"{"id":"example.app","name":"Example","version":"1","permissions":{"panels":["shell"]}}"#,
            r#"{"id":"example.app","name":"Example","version":"1","permissions":{"network":["https://127.0.0.1"]}}"#] { assert!(validate(files(manifest)).is_err()); }
    }
    #[test] fn bounds_expansion_and_rejects_case_aliases() {
        let mut files=BTreeMap::new(); let mut names=HashSet::new();
        assert!(insert(&mut files,&mut names,"huge".into(), std::io::repeat(0).take(MAX_FILE+1)).is_err());
        insert(&mut files,&mut names,"Game.js".into(), &b"hello"[..]).unwrap();
        assert!(insert(&mut files,&mut names,"game.js".into(), &b"evil"[..]).is_err());
    }
    #[test] fn zip_folder_and_html_imports() {
        use std::io::Write;
        let root=std::env::temp_dir().join(format!("tessera-package-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let folder=root.join("folder");std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("manifest.json"),BASIC).unwrap();std::fs::write(folder.join("index.html"),"<h1>App</h1>").unwrap();
        assert_eq!(inspect(&folder).unwrap().manifest.id,"example.app");
        let raw=root.join("game.html");std::fs::write(&raw,"<h1>Game</h1>").unwrap();
        let standalone=inspect(&raw).unwrap();assert!(standalone.manifest.id.starts_with("local."));assert!(standalone.manifest.permissions.panels.is_empty());
        let zip=root.join("valid.zip");
        let mut writer=zip::ZipWriter::new(std::fs::File::create(&zip).unwrap());
        for (name,bytes) in files(BASIC) {writer.start_file(format!("app/{name}"),zip::write::SimpleFileOptions::default()).unwrap();writer.write_all(&bytes).unwrap();}writer.finish().unwrap();
        assert_eq!(inspect(&zip).unwrap().manifest.id,"example.app");
        let bad=root.join("bad.zip");let mut writer=zip::ZipWriter::new(std::fs::File::create(&bad).unwrap());
        writer.start_file("../outside.html",zip::write::SimpleFileOptions::default()).unwrap();writer.write_all(b"escape").unwrap();writer.finish().unwrap();
        assert!(inspect(&bad).is_err());assert!(!root.parent().unwrap().join("outside.html").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
