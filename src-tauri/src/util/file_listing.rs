use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub extension: String,
    pub size: u64,
}

static FILE_CACHE: Mutex<Option<(String, Instant, Vec<FileEntry>)>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_secs(5);

fn scan_files(cwd: &str, limit: usize) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    let walker = ignore::WalkBuilder::new(cwd)
        .hidden(true)
        .git_ignore(true)
        .max_depth(Some(8))
        .build();

    for result in walker {
        if entries.len() >= limit * 10 {
            break;
        }
        if let Ok(entry) = result {
            let path = entry.path();
            if let Ok(rel) = path.strip_prefix(cwd) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                if rel_str.is_empty() {
                    continue;
                }
                let metadata = entry.metadata().ok();
                entries.push(FileEntry {
                    path: rel_str,
                    name: path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    is_dir: entry
                        .file_type()
                        .map(|ft| ft.is_dir())
                        .unwrap_or(false),
                    extension: path
                        .extension()
                        .map(|e| e.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    size: metadata.map(|m| m.len()).unwrap_or(0),
                });
            }
        }
    }
    entries
}

fn fuzzy_match(query: &str, path: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    let query_lower = query.to_lowercase();
    let path_lower = path.to_lowercase();
    // substring match
    if path_lower.contains(&query_lower) {
        return true;
    }
    // char-by-char fuzzy match
    let mut qi = query_lower.chars().peekable();
    for ch in path_lower.chars() {
        if qi.peek() == Some(&ch) {
            qi.next();
        }
        if qi.peek().is_none() {
            return true;
        }
    }
    false
}

fn score_match(query: &str, path: &str) -> i32 {
    let query_lower = query.to_lowercase();
    let path_lower = path.to_lowercase();
    let name_lower = path.rsplit('/').next().unwrap_or(path).to_lowercase();

    if name_lower == query_lower {
        return 100;
    }
    if name_lower.starts_with(&query_lower) {
        return 80;
    }
    if name_lower.contains(&query_lower) {
        return 60;
    }
    if path_lower.contains(&query_lower) {
        return 40;
    }
    20 // fuzzy match
}

#[tauri::command]
pub async fn list_project_files(
    cwd: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let limit = limit.unwrap_or(50);

    // Check cache
    let all_files = {
        let mut cache = FILE_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some((ref cached_cwd, ref cached_time, ref files)) = *cache {
            if cached_cwd == &cwd && cached_time.elapsed() < CACHE_TTL {
                files.clone()
            } else {
                let files = scan_files(&cwd, 5000);
                *cache = Some((cwd.clone(), Instant::now(), files.clone()));
                files
            }
        } else {
            let files = scan_files(&cwd, 5000);
            *cache = Some((cwd.clone(), Instant::now(), files.clone()));
            files
        }
    };

    let mut matched: Vec<(i32, FileEntry)> = all_files
        .into_iter()
        .filter(|f| fuzzy_match(&query, &f.path))
        .map(|f| {
            let score = score_match(&query, &f.path);
            (score, f)
        })
        .collect();

    matched.sort_by(|a, b| b.0.cmp(&a.0));

    Ok(matched.into_iter().take(limit).map(|(_, f)| f).collect())
}
