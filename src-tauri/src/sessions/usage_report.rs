//! Token and cost reports from the agents' own session files, the way
//! `ccusage daily|monthly|session` (and `ccusage codex`) read them, plus the
//! structured usage Tessera recorded for agents that keep no readable store.
//!
//! Sources, by provider:
//! - **claude**: every `.jsonl` under each Claude home's `projects/`.
//! - **codex**: `~/.codex/sessions/**/rollout-*.jsonl`, one `token_usage_record`
//!   per API response (older rollouts: the `token_count` events).
//! - **antigravity** and anything else: Tessera's Activity records, so only
//!   turns made through Tessera since recording began.
//!
//! Every `.jsonl` under each Claude home's `projects/` is parsed once and kept
//! in memory keyed by its modification time and size, so a report after the
//! first one only re-reads files that changed. Assistant messages are
//! de-duplicated by `message.id` + `requestId`: the CLI appends a new line for
//! the same message as content streams in, and counting each line would
//! multiply the totals (on this machine more than half of the lines are such
//! repeats).
use crate::util::claude_paths;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// USD per million tokens. Cache writes are 5-minute / 1-hour ephemeral entries.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pricing {
    pub input: f64,
    pub output: f64,
    pub cache_write_5m: f64,
    pub cache_write_1h: f64,
    pub cache_read: f64,
}
const fn price(input: f64, output: f64, cache_read: f64) -> Pricing {
    Pricing { input, output, cache_write_5m: input * 1.25, cache_write_1h: input * 2.0, cache_read }
}

/// Anthropic list prices (first-party API). Subscription use is not billed per
/// token; these are what the same tokens would cost on the API, like ccusage.
/// Longest prefix wins, so dated IDs (`claude-haiku-4-5-20251001`) match too.
const PRICES: &[(&str, Pricing)] = &[
    ("claude-fable-5-1", price(10.0, 50.0, 0.25)),
    ("claude-mythos-5-1", price(10.0, 50.0, 0.25)),
    ("claude-fable-5", price(10.0, 50.0, 1.0)),
    ("claude-mythos-5", price(10.0, 50.0, 1.0)),
    ("claude-opus-5-5", price(4.0, 20.0, 0.20)),
    ("claude-opus-5", price(5.0, 25.0, 0.50)),
    ("claude-opus-4-8", price(5.0, 25.0, 0.50)),
    ("claude-opus-4-7", price(5.0, 25.0, 0.50)),
    ("claude-opus-4-6", price(5.0, 25.0, 0.50)),
    ("claude-opus-4-5", price(5.0, 25.0, 0.50)),
    ("claude-opus-4-1", price(15.0, 75.0, 1.50)),
    ("claude-opus-4", price(15.0, 75.0, 1.50)),
    ("claude-sonnet-5-5", price(2.0, 10.0, 0.20)),
    ("claude-sonnet-5", price(2.0, 10.0, 0.20)),
    ("claude-sonnet-4", price(3.0, 15.0, 0.30)),
    ("claude-haiku-4-5", price(1.0, 5.0, 0.10)),
    ("claude-haiku-4", price(1.0, 5.0, 0.10)),
    ("claude-3-5-haiku", price(0.80, 4.0, 0.08)),
];

pub fn pricing_for(model: &str) -> Option<Pricing> {
    PRICES
        .iter()
        .filter(|(prefix, _)| model == *prefix || model.starts_with(&format!("{prefix}-")))
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, p)| *p)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    /// USD at list price for the priced models in this row.
    pub cost: f64,
    /// Tokens of models with no known price (gateway/local models): never costed.
    pub unpriced: u64,
}
impl Tokens {
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_write + self.cache_read
    }
    fn add(&mut self, other: &Tokens) {
        self.input += other.input;
        self.output += other.output;
        self.cache_write += other.cache_write;
        self.cache_read += other.cache_read;
        self.cost += other.cost;
        self.unpriced += other.unpriced;
    }
}

/// One de-duplicated model response.
#[derive(Clone, Debug)]
pub struct Entry {
    pub at: DateTime<Local>,
    /// claude | codex | antigravity | …
    pub provider: String,
    pub model: String,
    pub session_id: String,
    pub project: String,
    pub tokens: Tokens,
    key: Option<String>,
}

#[derive(Clone)]
struct FileData {
    modified: Option<SystemTime>,
    len: u64,
    entries: Vec<Entry>,
}

static CACHE: Mutex<Option<HashMap<PathBuf, FileData>>> = Mutex::new(None);

pub fn entry_from_line(line: &str, fallback_session: &str, fallback_project: &str) -> Option<Entry> {
    // Cheap pre-check: most lines are user turns, tool results, or metadata.
    if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    if value["type"] != "assistant" {
        return None;
    }
    let message = &value["message"];
    let usage = message.get("usage")?.as_object()?;
    let model = message["model"].as_str().unwrap_or("").to_string();
    if model.is_empty() || model == "<synthetic>" {
        return None;
    }
    let at = DateTime::parse_from_rfc3339(value["timestamp"].as_str()?).ok()?.with_timezone(&Local);
    let get = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
    // A missing key on a Map would panic; older files have no `cache_creation` object.
    let cache_1h = usage.get("cache_creation").and_then(|c| c["ephemeral_1h_input_tokens"].as_u64()).unwrap_or(0);
    let cache_write = get("cache_creation_input_tokens");
    let cache_5m = cache_write.saturating_sub(cache_1h);
    let (input, output, cache_read) = (get("input_tokens"), get("output_tokens"), get("cache_read_input_tokens"));
    let mut tokens = Tokens { input, output, cache_write, cache_read, cost: 0.0, unpriced: 0 };
    match pricing_for(&model) {
        Some(p) => {
            tokens.cost = (input as f64 * p.input + output as f64 * p.output + cache_5m as f64 * p.cache_write_5m
                + cache_1h as f64 * p.cache_write_1h + cache_read as f64 * p.cache_read) / 1_000_000.0;
        }
        None => tokens.unpriced = tokens.total(),
    }
    let key = match (message["id"].as_str(), value["requestId"].as_str()) {
        (Some(id), Some(request)) => Some(format!("{id}:{request}")),
        _ => None,
    };
    Some(Entry {
        at,
        provider: "claude".into(),
        model,
        session_id: value["sessionId"].as_str().unwrap_or(fallback_session).to_string(),
        project: value["cwd"].as_str().unwrap_or(fallback_project).to_string(),
        tokens,
        key,
    })
}

fn lines(path: &Path) -> impl Iterator<Item = String> {
    let file = std::fs::File::open(path).ok();
    let mut reader = file.map(std::io::BufReader::new);
    let mut bytes = Vec::new();
    std::iter::from_fn(move || {
        let reader = reader.as_mut()?;
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        }
    })
}

fn parse_file(path: &Path) -> Vec<Entry> {
    let session = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let project = path.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()).unwrap_or("").to_string();
    lines(path).filter_map(|line| entry_from_line(&line, &session, &project)).collect()
}

pub fn codex_sessions_dir() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".codex"))
        .join("sessions")
}

/// Codex counts cached input inside `input_tokens`; split it out like Activity does.
fn codex_tokens(usage: &Value) -> Option<Tokens> {
    let reported = usage["input_tokens"].as_u64()?;
    let output = usage["output_tokens"].as_u64().unwrap_or(0);
    let cache_read = usage["cached_input_tokens"].as_u64().unwrap_or(0).min(reported);
    let cache_write = usage["cache_write_input_tokens"].as_u64().unwrap_or(0).min(reported - cache_read);
    let input = reported - cache_read - cache_write;
    let mut tokens = Tokens { input, output, cache_write, cache_read, cost: 0.0, unpriced: 0 };
    tokens.unpriced = tokens.total();
    Some(tokens)
}

/// A Codex rollout. `token_usage_record` lines carry one API response each with a
/// unique `response_id`; rollouts written before that record existed are read
/// from their `token_count` events, taking each change of the running total once.
///
/// The session is the first `session_meta`'s `session_id`: a sub-agent rollout
/// names the thread that spawned it there (and appends that thread's meta
/// later), so its usage counts under the panel's thread; a fork names itself.
pub fn parse_codex_file(path: &Path) -> Vec<Entry> {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let mut session = stem.rsplit('-').next().unwrap_or(stem).to_string();
    let mut session_known = false;
    let mut project = String::new();
    let mut model = String::new();
    let mut records = vec![];
    let mut counts = vec![];
    let mut last_total: Option<Value> = None;
    for line in lines(path) {
        if !line.contains("token_usage_record") && !line.contains("token_count") && !line.contains("turn_context") && !line.contains("session_meta") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        let payload = &value["payload"];
        let at = value["timestamp"].as_str().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Local));
        match value["type"].as_str() {
            Some("session_meta") => {
                if !session_known {
                    if let Some(id) = payload["session_id"].as_str().or(payload["id"].as_str()) {
                        session = id.into();
                        session_known = true;
                    }
                }
                if let Some(cwd) = payload["cwd"].as_str() {
                    project = cwd.into();
                }
                if let Some(m) = payload["model"].as_str() {
                    model = m.into();
                }
            }
            Some("turn_context") => {
                if let Some(m) = payload["model"].as_str() {
                    model = m.into();
                }
                if let Some(cwd) = payload["cwd"].as_str() {
                    project = cwd.into();
                }
            }
            Some("token_usage_record") => {
                if let (Some(at), Some(tokens)) = (at, codex_tokens(&payload["usage"])) {
                    records.push(Entry { at, provider: "codex".into(), model: model.clone(), session_id: session.clone(), project: project.clone(), tokens,
                        key: payload["response_id"].as_str().map(|r| format!("codex:{r}")) });
                }
            }
            Some("event_msg") if payload["type"] == "token_count" => {
                let total = &payload["info"]["total_token_usage"];
                if total.is_null() || last_total.as_ref() == Some(total) {
                    continue;
                }
                last_total = Some(total.clone());
                if let (Some(at), Some(tokens)) = (at, codex_tokens(&payload["info"]["last_token_usage"])) {
                    counts.push(Entry { at, provider: "codex".into(), model: model.clone(), session_id: session.clone(), project: project.clone(), tokens, key: None });
                }
            }
            _ => {}
        }
    }
    if records.is_empty() { counts } else { records }
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

/// Every session file's entries, re-reading only files that changed.
fn all_entries() -> Vec<Entry> {
    let mut files = vec![];
    for root in claude_paths::projects_dirs() {
        walk(&root, &mut files);
    }
    let codex_root = codex_sessions_dir();
    walk(&codex_root, &mut files);
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    let mut fresh: HashMap<PathBuf, FileData> = HashMap::with_capacity(files.len());
    for path in files {
        let (modified, len) = std::fs::metadata(&path).map(|m| (m.modified().ok(), m.len())).unwrap_or((None, 0));
        let data = match cache.remove(&path) {
            Some(existing) if existing.modified == modified && existing.len == len && modified.is_some() => existing,
            _ => FileData { modified, len, entries: if path.starts_with(&codex_root) { parse_codex_file(&path) } else { parse_file(&path) } },
        };
        fresh.insert(path, data);
    }
    *cache = fresh;
    // Global de-duplication, then oldest first.
    let mut seen = HashSet::new();
    let mut entries: Vec<Entry> = cache
        .values()
        .flat_map(|data| data.entries.iter())
        .filter(|entry| entry.key.as_ref().is_none_or(|key| seen.insert(key.clone())))
        .cloned()
        .collect();
    entries.sort_by_key(|entry| entry.at);
    entries
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodRow {
    pub period: String,
    pub models: Vec<String>,
    pub messages: u64,
    #[serde(flatten)]
    pub tokens: Tokens,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRow {
    pub provider: String,
    pub sessions: u64,
    pub messages: u64,
    #[serde(flatten)]
    pub tokens: Tokens,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRow {
    pub provider: String,
    pub model: String,
    pub priced: bool,
    pub messages: u64,
    #[serde(flatten)]
    pub tokens: Tokens,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub provider: String,
    pub session_id: String,
    pub project: String,
    pub models: Vec<String>,
    pub first_at: i64,
    pub last_at: i64,
    pub messages: u64,
    #[serde(flatten)]
    pub tokens: Tokens,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub project: String,
    pub sessions: u64,
    pub messages: u64,
    #[serde(flatten)]
    pub tokens: Tokens,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub daily: Vec<PeriodRow>,
    pub monthly: Vec<PeriodRow>,
    pub models: Vec<ModelRow>,
    pub sessions: Vec<SessionRow>,
    pub projects: Vec<ProjectRow>,
    pub providers: Vec<ProviderRow>,
    pub totals: Tokens,
    pub messages: u64,
    pub files: usize,
    pub timezone: String,
}

fn group_periods(entries: &[&Entry], key: impl Fn(&Entry) -> String) -> Vec<PeriodRow> {
    let mut rows: BTreeMap<String, (BTreeSet<String>, u64, Tokens)> = BTreeMap::new();
    for entry in entries {
        let row = rows.entry(key(entry)).or_default();
        row.0.insert(entry.model.clone());
        row.1 += 1;
        row.2.add(&entry.tokens);
    }
    rows.into_iter()
        .map(|(period, (models, messages, tokens))| PeriodRow { period, models: models.into_iter().collect(), messages, tokens })
        .collect()
}

pub fn build_report(entries: &[Entry], start: &str, end: &str) -> Report {
    let day = |entry: &Entry| entry.at.format("%Y-%m-%d").to_string();
    let selected: Vec<&Entry> = entries.iter().filter(|e| { let d = day(e); d.as_str() >= start && d.as_str() <= end }).collect();
    let mut models: BTreeMap<(String, String), (u64, Tokens)> = BTreeMap::new();
    let mut providers: BTreeMap<String, (BTreeSet<String>, u64, Tokens)> = BTreeMap::new();
    let mut sessions: BTreeMap<String, SessionRow> = BTreeMap::new();
    let mut projects: BTreeMap<String, (BTreeSet<String>, u64, Tokens)> = BTreeMap::new();
    let mut totals = Tokens::default();
    for entry in &selected {
        totals.add(&entry.tokens);
        let model = models.entry((entry.provider.clone(), entry.model.clone())).or_default();
        model.0 += 1;
        model.1.add(&entry.tokens);
        let provider = providers.entry(entry.provider.clone()).or_default();
        provider.0.insert(entry.session_id.clone());
        provider.1 += 1;
        provider.2.add(&entry.tokens);
        let at = entry.at.timestamp_millis();
        let session = sessions.entry(format!("{}:{}", entry.provider, entry.session_id)).or_insert_with(|| SessionRow {
            provider: entry.provider.clone(), session_id: entry.session_id.clone(), project: entry.project.clone(), models: vec![], first_at: at, last_at: at, messages: 0, tokens: Tokens::default(),
        });
        if !session.models.contains(&entry.model) {
            session.models.push(entry.model.clone());
        }
        session.first_at = session.first_at.min(at);
        session.last_at = session.last_at.max(at);
        session.messages += 1;
        session.tokens.add(&entry.tokens);
        let project = projects.entry(entry.project.clone()).or_default();
        project.0.insert(entry.session_id.clone());
        project.1 += 1;
        project.2.add(&entry.tokens);
    }
    let mut sessions: Vec<SessionRow> = sessions.into_values().collect();
    sessions.sort_by_key(|s| std::cmp::Reverse(s.last_at));
    let mut models: Vec<ModelRow> = models
        .into_iter()
        .map(|((provider, model), (messages, tokens))| ModelRow { priced: tokens.unpriced == 0 && tokens.total() > 0, provider, model, messages, tokens })
        .collect();
    models.sort_by(|a, b| b.tokens.cost.partial_cmp(&a.tokens.cost).unwrap_or(std::cmp::Ordering::Equal).then(b.tokens.total().cmp(&a.tokens.total())));
    let mut projects: Vec<ProjectRow> = projects
        .into_iter()
        .map(|(project, (sessions, messages, tokens))| ProjectRow { project, sessions: sessions.len() as u64, messages, tokens })
        .collect();
    projects.sort_by(|a, b| b.tokens.cost.partial_cmp(&a.tokens.cost).unwrap_or(std::cmp::Ordering::Equal).then(b.tokens.total().cmp(&a.tokens.total())));
    let providers = providers
        .into_iter()
        .map(|(provider, (sessions, messages, tokens))| ProviderRow { provider, sessions: sessions.len() as u64, messages, tokens })
        .collect();
    Report {
        daily: group_periods(&selected, day),
        monthly: group_periods(&selected, |e| e.at.format("%Y-%m").to_string()),
        models,
        sessions,
        projects,
        providers,
        totals,
        messages: selected.len() as u64,
        files: CACHE.lock().map(|c| c.as_ref().map(HashMap::len).unwrap_or(0)).unwrap_or(0),
        timezone: Local::now().format("%Z").to_string(),
    }
}

/// Agents without a readable session store (Antigravity): the turns Tessera recorded.
/// Claude and Codex are read from their own files above, so they are excluded here.
fn activity_entries(db: &crate::db::Database) -> Result<Vec<Entry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT started_at, data FROM activity_records WHERE kind='turn' AND json_extract(data,'$.actor.provider') NOT IN ('claude','codex') AND json_extract(data,'$.usage') IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut entries = vec![];
    for row in rows {
        let (started_at, data) = row.map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        let Some(at) = DateTime::from_timestamp_millis(started_at) else { continue };
        let usage = &value["usage"];
        let mut tokens = Tokens {
            input: usage["input"].as_u64().unwrap_or(0),
            output: usage["output"].as_u64().unwrap_or(0),
            cache_write: usage["cacheWrite"].as_u64().unwrap_or(0),
            cache_read: usage["cacheRead"].as_u64().unwrap_or(0),
            cost: 0.0,
            unpriced: 0,
        };
        tokens.unpriced = tokens.total();
        entries.push(Entry {
            at: at.with_timezone(&Local),
            provider: value["actor"]["provider"].as_str().unwrap_or("unknown").into(),
            model: value["actor"]["model"].as_str().unwrap_or("").into(),
            session_id: value["sessionId"].as_str().unwrap_or("").into(),
            project: value["actor"]["name"].as_str().map(|n| format!("(panel) {n}")).unwrap_or_default(),
            tokens,
            key: value["id"].as_str().map(|id| format!("activity:{id}")),
        });
    }
    Ok(entries)
}

fn valid_date(value: &str) -> bool {
    value.len() == 10 && value.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
}

/// Local-day inclusive range. Parsing happens off the async runtime.
#[tauri::command]
pub async fn usage_report(start_date: String, end_date: String, db: tauri::State<'_, crate::db::Database>) -> Result<Report, String> {
    if !valid_date(&start_date) || !valid_date(&end_date) {
        return Err("Dates must be YYYY-MM-DD.".into());
    }
    let recorded = activity_entries(&db)?;
    tokio::task::spawn_blocking(move || {
        let mut entries = all_entries();
        entries.extend(recorded);
        entries.sort_by_key(|entry| entry.at);
        build_report(&entries, &start_date, &end_date)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Totals for one Codex thread (its own rollout plus its sub-agents'), for the
/// Session usage dialog. Reads through the same cache as the report, so a poll
/// re-parses only the rollouts that changed.
#[tauri::command]
pub async fn codex_session_usage(thread_id: String) -> Result<super::usage_parser::UsageInfo, String> {
    if thread_id.is_empty() || !thread_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid Codex thread ID.".into());
    }
    Ok(tokio::task::spawn_blocking(move || {
        let mut info = super::usage_parser::UsageInfo::default();
        let mut models = BTreeSet::new();
        for entry in all_entries().into_iter().filter(|e| e.provider == "codex" && e.session_id == thread_id) {
            info.input_tokens += entry.tokens.input;
            info.output_tokens += entry.tokens.output;
            info.cache_read_tokens += entry.tokens.cache_read;
            info.cache_write_tokens += entry.tokens.cache_write;
            info.message_count += 1;
            if !entry.model.is_empty() {
                models.insert(entry.model);
            }
        }
        info.models = models.into_iter().collect();
        info
    })
    .await
    .map_err(|e| e.to_string())?)
}

/// Totals for one session, de-duplicated and priced like the report.
pub fn session_totals(path: &Path) -> super::usage_parser::UsageInfo {
    let mut seen = HashSet::new();
    let mut info = super::usage_parser::UsageInfo::default();
    let mut models = BTreeSet::new();
    for entry in parse_file(path) {
        if !entry.key.as_ref().is_none_or(|key| seen.insert(key.clone())) {
            continue;
        }
        info.input_tokens += entry.tokens.input;
        info.output_tokens += entry.tokens.output;
        info.cache_read_tokens += entry.tokens.cache_read;
        info.cache_write_tokens += entry.tokens.cache_write;
        info.total_cost_usd += entry.tokens.cost;
        info.message_count += 1;
        info.priced = info.priced || entry.tokens.unpriced == 0;
        models.insert(entry.model);
    }
    info.models = models.into_iter().collect();
    info
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(id: &str, request: &str, model: &str, at: &str, usage: Value) -> String {
        json!({"type":"assistant","timestamp":at,"requestId":request,"sessionId":"s1","cwd":"C:\\p",
            "message":{"id":id,"model":model,"usage":usage}}).to_string()
    }

    #[test]
    fn prices_known_models_by_longest_prefix_and_leaves_others_unpriced() {
        assert_eq!(pricing_for("claude-opus-5-5").unwrap().input, 4.0);
        assert_eq!(pricing_for("claude-opus-5").unwrap().input, 5.0);
        assert_eq!(pricing_for("claude-haiku-4-5-20251001").unwrap().output, 5.0);
        assert_eq!(pricing_for("claude-fable-5-1").unwrap().cache_read, 0.25);
        assert_eq!(pricing_for("claude-fable-5").unwrap().cache_read, 1.0);
        assert!(pricing_for("gemini-3.8-flash").is_none());
        assert!(pricing_for("qwen3.8:27b").is_none());
        assert!(pricing_for("claude-sonnet-50").is_none(), "prefix must end at a dash");
    }

    #[test]
    fn costs_every_token_class_and_marks_unpriced_models() {
        let usage = json!({"input_tokens":1000,"output_tokens":2000,"cache_creation_input_tokens":4000,"cache_read_input_tokens":8000,
            "cache_creation":{"ephemeral_5m_input_tokens":1000,"ephemeral_1h_input_tokens":3000}});
        let entry = entry_from_line(&line("m1", "r1", "claude-opus-5-5", "2026-10-02T19:35:45.947Z", usage.clone()), "s", "p").unwrap();
        // 1000*4 + 2000*20 + 1000*5 + 3000*8 + 8000*0.20 = 4000+40000+5000+24000+1600 = 74600 per M
        assert!((entry.tokens.cost - 0.0746).abs() < 1e-9, "{}", entry.tokens.cost);
        assert_eq!(entry.tokens.total(), 15000);
        assert_eq!(entry.tokens.unpriced, 0);
        let local = entry_from_line(&line("m2", "r2", "qwen3.8:27b", "2026-10-02T19:35:45.947Z", usage), "s", "p").unwrap();
        assert_eq!((local.tokens.cost, local.tokens.unpriced), (0.0, 15000));
        assert!(entry_from_line(&line("m3", "r3", "<synthetic>", "2026-10-02T19:35:45.947Z", json!({"input_tokens":1})), "s", "p").is_none());
        assert!(entry_from_line(r#"{"type":"user","message":{"content":"usage assistant"}}"#, "s", "p").is_none());
    }

    #[test]
    fn report_deduplicates_streamed_repeats_and_buckets_by_local_day_and_month() {
        let usage = json!({"input_tokens":100,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0});
        let mut entries: Vec<Entry> = [
            line("m1", "r1", "claude-sonnet-5-5", "2026-09-30T23:30:00Z", usage.clone()),
            line("m1", "r1", "claude-sonnet-5-5", "2026-09-30T23:30:05Z", usage.clone()),
            line("m1", "r1", "claude-sonnet-5-5", "2026-09-30T23:30:09Z", usage.clone()),
            line("m2", "r2", "claude-opus-5-5", "2026-10-01T10:00:00Z", usage.clone()),
            json!({"type":"assistant","timestamp":"2026-10-01T11:00:00Z","sessionId":"s2","cwd":"D:\\q","message":{"model":"claude-opus-5-5","usage":usage}}).to_string(),
        ]
        .iter()
        .filter_map(|l| entry_from_line(l, "fallback", "p"))
        .collect();
        // Same global de-duplication as all_entries().
        let mut seen = HashSet::new();
        entries.retain(|e| e.key.as_ref().is_none_or(|k| seen.insert(k.clone())));
        assert_eq!(entries.len(), 3, "three streamed lines of one message count once; a line without ids still counts");
        let report = build_report(&entries, "2020-01-01", "2030-01-01");
        assert_eq!(report.messages, 3);
        assert_eq!(report.totals.input, 300);
        assert_eq!(report.daily.iter().map(|d| d.messages).sum::<u64>(), 3);
        let september: Vec<_> = report.monthly.iter().filter(|m| m.period == "2026-09").collect();
        let local_day = entries[0].at.format("%Y-%m-%d").to_string();
        assert!(report.daily.iter().any(|d| d.period == local_day && d.models.contains(&"claude-sonnet-5-5".to_string())), "days are local, not UTC");
        assert!(september.len() <= 1);
        assert_eq!(report.sessions.len(), 2);
        assert_eq!(report.sessions[0].session_id, "s2", "newest session first");
        assert_eq!(report.providers.len(), 1);
        assert_eq!((report.providers[0].provider.as_str(), report.providers[0].sessions, report.providers[0].messages), ("claude", 2, 3));
        assert_eq!(report.projects.len(), 2);
        assert_eq!(report.models.len(), 2);
        let narrow = build_report(&entries, &local_day, &local_day);
        assert!(narrow.messages >= 1 && narrow.messages <= 3 && narrow.daily.len() == 1);
        assert_eq!(build_report(&entries, "2027-01-01", "2027-12-31").messages, 0);
    }

    #[test]
    fn session_totals_follow_the_same_rules() {
        let dir = std::env::temp_dir().join(format!("tessera-usage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abc.jsonl");
        let usage = json!({"input_tokens":5,"output_tokens":7,"cache_creation_input_tokens":11,"cache_read_input_tokens":13});
        std::fs::write(&path, [
            line("m1", "r1", "claude-haiku-4-5-20251001", "2026-10-02T10:00:00Z", usage.clone()),
            line("m1", "r1", "claude-haiku-4-5-20251001", "2026-10-02T10:00:01Z", usage.clone()),
            line("m2", "r2", "gemini-3.8-flash", "2026-10-02T10:00:02Z", usage),
        ].join("\n")).unwrap();
        let info = session_totals(&path);
        assert_eq!((info.message_count, info.input_tokens, info.output_tokens, info.cache_write_tokens, info.cache_read_tokens), (2, 10, 14, 22, 26));
        assert!(info.priced);
        assert!(info.total_cost_usd > 0.0);
        assert_eq!(info.models, ["claude-haiku-4-5-20251001", "gemini-3.8-flash"]);
        assert_eq!(session_totals(&dir.join("missing.jsonl")).message_count, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Line shapes recorded from Codex 0.154 rollouts.
    #[test]
    fn codex_rollouts_count_each_response_once_with_cached_input_split_out() {
        let dir = std::env::temp_dir().join(format!("tessera-codex-usage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-2026-10-03T18-44-48-01a10270-7a06-7c91-8d3a-fd0d4b372b7c.jsonl");
        let usage = json!({"input_tokens":15219,"cached_input_tokens":12288,"cache_write_input_tokens":0,"output_tokens":302,"reasoning_output_tokens":0,"total_tokens":15521});
        let record = |response: &str, at: &str| json!({"timestamp":at,"type":"token_usage_record","payload":{"thread_id":"01a10270-7a06-7c91-8d3a-fd0d4b372b7c","response_id":response,"usage":usage}}).to_string();
        std::fs::write(&path, [
            json!({"timestamp":"2026-10-03T15:44:48Z","type":"session_meta","payload":{"id":"01a10270-7a06-7c91-8d3a-fd0d4b372b7c","cwd":"C:\\Users\\ady\\tessera","originator":"codex-tui"}}).to_string(),
            json!({"timestamp":"2026-10-03T15:44:49Z","type":"turn_context","payload":{"model":"gpt-6-astra","cwd":"C:\\Users\\ady\\tessera"}}).to_string(),
            json!({"timestamp":"2026-10-03T15:45:26Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":usage,"last_token_usage":usage}}}).to_string(),
            record("resp_a", "2026-10-03T15:45:26.639Z"),
            record("resp_a", "2026-10-03T15:45:26.639Z"),
            record("resp_b", "2026-10-03T15:46:00Z"),
        ].join("\n")).unwrap();
        let entries = parse_codex_file(&path);
        assert_eq!(entries.len(), 3, "records win over token_count events; the repeat is removed by the global key");
        assert!(entries.iter().all(|e| e.provider == "codex" && e.model == "gpt-6-astra" && e.session_id == "01a10270-7a06-7c91-8d3a-fd0d4b372b7c" && e.project.ends_with("tessera")));
        assert_eq!((entries[0].tokens.input, entries[0].tokens.cache_read, entries[0].tokens.output, entries[0].tokens.unpriced), (2931, 12288, 302, 15521));
        let mut seen = HashSet::new();
        let unique: Vec<Entry> = entries.into_iter().filter(|e| e.key.as_ref().is_none_or(|k| seen.insert(k.clone()))).collect();
        assert_eq!(unique.len(), 2);
        let report = build_report(&unique, "2020-01-01", "2030-01-01");
        assert_eq!((report.providers[0].provider.as_str(), report.providers[0].messages), ("codex", 2));
        assert_eq!(report.models[0].priced, false);
        assert_eq!(report.totals.cost, 0.0);
        assert_eq!(report.totals.unpriced, 31042);
        // An older rollout without records falls back to distinct token_count totals.
        let old = dir.join("rollout-2026-09-01T10-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
        let total1 = json!({"input_tokens":100,"cached_input_tokens":0,"output_tokens":10,"total_tokens":110});
        let total2 = json!({"input_tokens":300,"cached_input_tokens":100,"output_tokens":30,"total_tokens":330});
        std::fs::write(&old, [
            json!({"timestamp":"2026-09-01T10:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":total1,"last_token_usage":total1}}}).to_string(),
            json!({"timestamp":"2026-09-01T10:00:01Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":total1,"last_token_usage":total1}}}).to_string(),
            json!({"timestamp":"2026-09-01T10:00:02Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":total2,"last_token_usage":{"input_tokens":200,"cached_input_tokens":100,"output_tokens":20,"total_tokens":220}}}}).to_string(),
        ].join("\n")).unwrap();
        // A sub-agent rollout counts under the thread that spawned it; a fork under itself.
        let sub = dir.join("rollout-2026-10-03T23-48-17-01a10386-5281-79d0-b73f-26205c14ac57.jsonl");
        std::fs::write(&sub, [
            json!({"timestamp":"2026-10-03T20:48:17Z","type":"session_meta","payload":{"session_id":"01a10270-7a06-7c91-8d3a-fd0d4b372b7c","id":"01a10386-5281-79d0-b73f-26205c14ac57","thread_source":"subagent","cwd":"C:/x"}}).to_string(),
            record("resp_sub", "2026-10-03T20:49:00Z"),
            json!({"timestamp":"2026-10-03T20:50:00Z","type":"session_meta","payload":{"session_id":"01a10270-7a06-7c91-8d3a-fd0d4b372b7c","id":"01a10270-7a06-7c91-8d3a-fd0d4b372b7c"}}).to_string(),
        ].join("
")).unwrap();
        assert_eq!(parse_codex_file(&sub)[0].session_id, "01a10270-7a06-7c91-8d3a-fd0d4b372b7c");
        let fork = dir.join("rollout-2026-10-03T23-50-00-ffffffff-1111-2222-3333-444444444444.jsonl");
        std::fs::write(&fork, [
            json!({"timestamp":"2026-10-03T20:50:00Z","type":"session_meta","payload":{"session_id":"ffffffff-1111-2222-3333-444444444444","id":"ffffffff-1111-2222-3333-444444444444","originator":"tessera"}}).to_string(),
            record("resp_fork", "2026-10-03T20:51:00Z"),
        ].join("
")).unwrap();
        assert_eq!(parse_codex_file(&fork)[0].session_id, "ffffffff-1111-2222-3333-444444444444");
        let fallback = parse_codex_file(&old);
        assert_eq!(fallback.len(), 2);
        assert_eq!(fallback.iter().map(|e| e.tokens.total()).sum::<u64>(), 330);
        assert_eq!(fallback[0].session_id, "eeeeeeeeeeee", "without session_meta the file name's last segment is the best id available");
        let _ = std::fs::remove_dir_all(dir);
    }
}
