//! Public GitHub catalogs: pin one commit, keep the reviewed catalog in the
//! host, verify ZIP bytes, then use the normal permission/install preview.
use super::*;
use sha2::{Digest,Sha256};
use std::collections::HashSet;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Entry {
    pub id:String, pub name:String, pub version:String,
    #[serde(default)] pub description:String,
    #[serde(default="category")] pub category:String,
    #[serde(default="icon")] pub icon:String,
    pub package:String, pub sha256:String,
}
fn category()->String{"Other".into()} fn icon()->String{"Puzzle".into()}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog { version:u32, apps:Vec<Entry> }
pub struct Snapshot { repository:String, commit:String, apps:Vec<Entry>, created:Instant }

pub fn repository(value:&str)->Result<String,String> {
    let url=tauri::Url::parse(value.trim()).map_err(|_|"Use a public repository URL: https://github.com/owner/repo")?;
    if url.scheme()!="https" || url.host_str()!=Some("github.com") || !url.username().is_empty() || url.password().is_some() || url.port().is_some() || url.query().is_some() || url.fragment().is_some() {return Err("Use a public https://github.com/owner/repo URL".into());}
    let path=url.path().trim_matches('/').trim_end_matches(".git");let parts=path.split('/').collect::<Vec<_>>();
    if parts.len()!=2 || parts.iter().any(|p|p.is_empty()||p.len()>100||*p=="."||*p==".."||!p.bytes().all(|b|b.is_ascii_alphanumeric()||b"-_.".contains(&b))) {return Err("Use the repository's home URL, without /tree or /blob. Set a branch separately.".into());}
    Ok(parts.join("/"))
}
fn validate(bytes:&[u8])->Result<Vec<Entry>,String>{
    if bytes.len()>1024*1024{return Err("Catalog exceeds 1 MB".into());}
    let catalog:Catalog=serde_json::from_slice(bytes).map_err(|e|format!("Invalid tessera-apps.json: {e}"))?;
    if catalog.version!=1||catalog.apps.len()>128{return Err("Use catalog version 1 with at most 128 apps".into());}
    let mut ids=HashSet::new();
    for entry in &catalog.apps {
        if !package::valid_id(&entry.id)||!ids.insert(&entry.id)||entry.name.trim().is_empty()||entry.name.len()>100||entry.name.chars().any(char::is_control)||entry.version.is_empty()||entry.version.len()>40||entry.description.len()>1000||entry.category.is_empty()||entry.category.len()>40||entry.category.chars().any(char::is_control){return Err("Invalid or duplicate catalog app".into());}
        package::asset_path(&entry.package)?;
        if !entry.package.ends_with(".zip")||entry.sha256.len()!=64||!entry.sha256.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Every app needs a relative ZIP path and SHA-256 checksum".into());}
        if !["Puzzle","Calculator","FileText","NotebookPen","Clock","Timer","Gamepad2","Dice5","Trophy","Globe","Music","BookOpen","MessageCircle"].contains(&entry.icon.as_str()){return Err("Use a supported icon name in the catalog".into());}
    }
    Ok(catalog.apps)
}

async fn download(url:tauri::Url,max:usize)->Result<Vec<u8>,String>{
    // Fixed public hosts, no ambient proxy, cookies, credentials or redirects.
    if url.scheme()!="https"||!matches!(url.host_str(),Some("api.github.com"|"raw.githubusercontent.com"))||url.port().is_some()||!url.username().is_empty()||url.password().is_some(){return Err("Only GitHub catalog downloads are supported".into());}
    let client=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(40)).user_agent("Tessera-App-Library").build().map_err(|e|e.to_string())?;
    let mut response=client.get(url).header("Accept","application/vnd.github+json").header("X-GitHub-Api-Version","2022-11-28").send().await.map_err(|e|format!("Could not reach GitHub: {e}"))?;
    match response.status().as_u16(){
        200=>{},404=>return Err("Repository, branch, or catalog file not found. The repository must be public and contain tessera-apps.json at its root.".into()),
        403|429=>return Err("GitHub temporarily limited these requests. Try again later.".into()),
        status=>return Err(format!("GitHub returned HTTP {status}. Check the repository URL and try again.")),
    }
    if response.content_length().is_some_and(|n|n>max as u64){return Err("Download exceeds the size limit".into());}
    let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|e|e.to_string())?{if bytes.len()+chunk.len()>max{return Err("Download exceeds the size limit".into());}bytes.extend_from_slice(&chunk);}
    Ok(bytes)
}
fn raw_url(repo:&str,commit:&str,path:&str)->Result<tauri::Url,String>{
    let mut url:tauri::Url="https://raw.githubusercontent.com/".parse().unwrap();url.set_path(&format!("{repo}/{commit}/{path}"));Ok(url)
}

#[tauri::command]
pub async fn html_catalog_list(caller:Webview,app:tauri::AppHandle,state:tauri::State<'_,HtmlPlugins>,repository_url:String,reference:Option<String>)->Result<Value,String>{
    main_only(&caller)?;let repo=repository(&repository_url)?;let reference=reference.filter(|r|!r.trim().is_empty()).unwrap_or_else(||"HEAD".into());
    if reference.len()>200||reference.chars().any(char::is_control){return Err("Invalid branch or tag".into());}
    let mut url:tauri::Url=format!("https://api.github.com/repos/{repo}/commits/").parse().unwrap();url.path_segments_mut().unwrap().pop_if_empty().push(&reference);
    let data:Value=serde_json::from_slice(&download(url,2*1024*1024).await?).map_err(|e|e.to_string())?;
    let commit=data["sha"].as_str().filter(|s|s.len()==40&&s.bytes().all(|b|b.is_ascii_hexdigit())).ok_or("GitHub did not return a commit")?.to_string();
    let apps=validate(&download(raw_url(&repo,&commit,"tessera-apps.json")?,1024*1024).await?)?;
    let ticket=uuid::Uuid::new_v4().to_string();let result=json!({"ticket":ticket,"repository":format!("https://github.com/{repo}"),"commit":commit,"apps":apps});
    let mut inner=state.0.lock().map_err(|e|e.to_string())?;ensure_loaded(&app,&mut inner)?;
    inner.catalogs.retain(|_,s|s.created.elapsed()<Duration::from_secs(1800));if inner.catalogs.len()>=4{inner.catalogs.clear();}
    inner.catalogs.insert(ticket,Snapshot{repository:repo,commit,apps,created:Instant::now()});Ok(result)
}
fn verified_package(bytes:Vec<u8>,entry:&Entry)->Result<Package,String>{
    if bytes.len()>package::MAX_PACKAGE||format!("{:x}",Sha256::digest(&bytes))!=entry.sha256.to_ascii_lowercase(){return Err("Package checksum does not match the catalog. Nothing was installed.".into());}
    let package=package::inspect_zip(std::io::Cursor::new(bytes))?;
    if package.manifest.id!=entry.id||package.manifest.version!=entry.version||package.manifest.name!=entry.name{return Err("The package identity/version does not match the catalog".into());}
    Ok(package)
}
#[tauri::command]
pub async fn html_catalog_preview(caller:Webview,app:tauri::AppHandle,state:tauri::State<'_,HtmlPlugins>,ticket:String,id:String)->Result<Value,String>{
    main_only(&caller)?;
    let (repo,commit,entry)={let inner=state.0.lock().map_err(|e|e.to_string())?;let snapshot=inner.catalogs.get(&ticket).filter(|s|s.created.elapsed()<Duration::from_secs(1800)).ok_or("Refresh the catalog before downloading")?;(snapshot.repository.clone(),snapshot.commit.clone(),snapshot.apps.iter().find(|e|e.id==id).ok_or("App is not in this catalog")?.clone())};
    let bytes=download(raw_url(&repo,&commit,&entry.package)?,package::MAX_PACKAGE).await?;
    let package=tokio::task::spawn_blocking(move||verified_package(bytes,&entry)).await.map_err(|e|e.to_string())??;
    let mut preview=preview_package(&app,&state,package)?;preview["source"]=json!(format!("https://github.com/{repo} · {}",&commit[..8]));Ok(preview)
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn repositories_cannot_choose_hosts_or_credentials(){assert_eq!(repository("https://github.com/example/apps.git/").unwrap(),"example/apps");for s in ["http://github.com/a/b","https://github.com.evil/a/b","https://token@github.com/a/b","https://github.com/a/b/tree/main","https://github.com/a/b?x=1","file:///C:/repo"]{assert!(repository(s).is_err(),"{s}");}}
    fn entry()->Value{json!({"id":"example.clock","name":"Clock","version":"1","package":"packages/clock.zip","sha256":"a".repeat(64)})}
    #[test]fn verified_zip_still_checks_manifest_identity_and_safe_paths(){
        use std::io::Write;
        fn zip(path:&str)->Vec<u8>{
            let mut writer=zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            for (path,content) in [("manifest.json",r#"{"id":"example.clock","name":"Clock","version":"1"}"#),(path,"<h1>Clock</h1>")]{writer.start_file(path,zip::write::SimpleFileOptions::default()).unwrap();writer.write_all(content.as_bytes()).unwrap();}
            writer.finish().unwrap().into_inner()
        }
        let bytes=zip("index.html");let mut entry:Entry=serde_json::from_value(entry()).unwrap();entry.sha256=format!("{:x}",Sha256::digest(&bytes));
        assert_eq!(verified_package(bytes.clone(),&entry).unwrap().manifest.id,"example.clock");
        entry.id="other.clock".into();assert!(verified_package(bytes,&entry).err().unwrap().contains("identity"));
        let bytes=zip("../outside.html");entry.sha256=format!("{:x}",Sha256::digest(&bytes));assert!(verified_package(bytes,&entry).is_err());
        let url=raw_url("owner/repo",&"a".repeat(40),"packages/clock one.zip").unwrap();assert_eq!(url.host_str(),Some("raw.githubusercontent.com"));assert!(url.as_str().contains("clock%20one.zip"));
    }
    #[test]fn invalid_catalogs_and_checksums_never_reach_install(){let e=entry();let mut traversal=entry();traversal["package"]=json!("../bad.zip");assert_eq!(validate(&serde_json::to_vec(&json!({"version":1,"apps":[e]})).unwrap()).unwrap().len(),1);for bad in [json!({"version":2,"apps":[]}),json!({"version":1,"apps":[entry(),entry()]}),json!({"version":1,"apps":[traversal]})]{assert!(validate(&serde_json::to_vec(&bad).unwrap()).is_err());}let e:Entry=serde_json::from_value(entry()).unwrap();assert!(verified_package(b"wrong".to_vec(),&e).err().unwrap().contains("checksum"));}
}
