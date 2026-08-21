use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostHogEvent {
    pub event: String,
    pub properties: serde_json::Value,
    pub timestamp: String,
}

pub struct PostHogTracker {
    enabled: Mutex<bool>,
    queue: Mutex<Vec<PostHogEvent>>,
    api_key: Mutex<String>,
    distinct_id: Mutex<String>,
}

impl PostHogTracker {
    pub fn new() -> Self {
        Self {
            enabled: Mutex::new(false),
            queue: Mutex::new(Vec::new()),
            api_key: Mutex::new(String::new()),
            distinct_id: Mutex::new(String::new()),
        }
    }
}

#[tauri::command]
pub async fn posthog_init(
    api_key: String,
    distinct_id: String,
    state: tauri::State<'_, PostHogTracker>,
) -> Result<(), String> {
    *state.api_key.lock().map_err(|e| e.to_string())? = api_key;
    *state.distinct_id.lock().map_err(|e| e.to_string())? = distinct_id;
    *state.enabled.lock().map_err(|e| e.to_string())? = true;
    Ok(())
}

#[tauri::command]
pub async fn posthog_track(
    event: String,
    properties: Option<serde_json::Value>,
    state: tauri::State<'_, PostHogTracker>,
) -> Result<(), String> {
    let enabled = *state.enabled.lock().map_err(|e| e.to_string())?;
    if !enabled {
        return Ok(());
    }

    let props = properties.unwrap_or(serde_json::Value::Object(Default::default()));
    let evt = PostHogEvent {
        event,
        properties: props,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
    queue.push(evt);

    // Cap queue size at 1000 to prevent unbounded growth if flush fails.
    // Drop the oldest events when the limit is exceeded.
    const MAX_QUEUE_SIZE: usize = 1000;
    if queue.len() > MAX_QUEUE_SIZE {
        let excess = queue.len() - MAX_QUEUE_SIZE;
        queue.drain(..excess);
    }

    // Auto-flush at batch size 10
    if queue.len() >= 10 {
        let events: Vec<PostHogEvent> = queue.drain(..).collect();
        let api_key = state.api_key.lock().map_err(|e| e.to_string())?.clone();
        let distinct_id = state
            .distinct_id
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        drop(queue);
        tokio::spawn(async move {
            let _ = flush_events(&api_key, &distinct_id, events).await;
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn posthog_flush(
    state: tauri::State<'_, PostHogTracker>,
) -> Result<(), String> {
    let events: Vec<PostHogEvent> = {
        let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
        queue.drain(..).collect()
    };
    if events.is_empty() {
        return Ok(());
    }

    let api_key = state.api_key.lock().map_err(|e| e.to_string())?.clone();
    let distinct_id = state
        .distinct_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    flush_events(&api_key, &distinct_id, events)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn posthog_set_enabled(
    enabled: bool,
    state: tauri::State<'_, PostHogTracker>,
) -> Result<(), String> {
    *state.enabled.lock().map_err(|e| e.to_string())? = enabled;
    Ok(())
}

#[tauri::command]
pub async fn posthog_is_enabled(
    state: tauri::State<'_, PostHogTracker>,
) -> Result<bool, String> {
    Ok(*state.enabled.lock().map_err(|e| e.to_string())?)
}

async fn flush_events(
    api_key: &str,
    distinct_id: &str,
    events: Vec<PostHogEvent>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if api_key.is_empty() {
        return Ok(());
    }

    let batch: Vec<serde_json::Value> = events
        .iter()
        .map(|e| {
            // Build properties map: start with event properties, then add our fields
            let mut props = serde_json::Map::new();
            if let Some(obj) = e.properties.as_object() {
                for (k, v) in obj {
                    props.insert(k.clone(), v.clone());
                }
            }
            props.insert(
                "distinct_id".to_string(),
                serde_json::Value::String(distinct_id.to_string()),
            );
            props.insert(
                "$lib".to_string(),
                serde_json::Value::String("tessera".to_string()),
            );

            serde_json::json!({
                "event": e.event,
                "properties": props,
                "timestamp": e.timestamp,
            })
        })
        .collect();

    let body = serde_json::json!({
        "api_key": api_key,
        "batch": batch,
    });

    let client = reqwest::Client::new();
    client
        .post("https://us.i.posthog.com/batch")
        .json(&body)
        .send()
        .await?;

    Ok(())
}
