use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use crate::activity::{model::{Actor, Record, now}, record_api};

use super::providers;

pub struct LlmSession {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub system_prompt: String,
    /// Forwarded to providers that accept it; the anthropic path ignores it
    /// (current Claude models reject the parameter).
    pub temperature: Option<f32>,
    pub cancel: Arc<tokio::sync::Notify>,
}

pub struct LlmManager {
    sessions: Mutex<HashMap<String, LlmSession>>,
    client: reqwest::Client,
}

impl LlmManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            client: reqwest::Client::new(),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct ChunkPayload {
    content: String,
}

#[derive(Clone, serde::Serialize)]
struct ErrorPayload {
    error: String,
}

#[tauri::command]
pub async fn llm_create_session(
    id: String,
    provider: String,
    model: String,
    base_url: String,
    api_key: Option<String>,
    system_prompt: String,
    temperature: Option<f32>,
    state: tauri::State<'_, LlmManager>,
) -> Result<(), String> {
    let session = LlmSession {
        provider,
        model,
        base_url,
        api_key,
        system_prompt,
        temperature,
        cancel: Arc::new(tokio::sync::Notify::new()),
    };
    state.sessions.lock().await.insert(id, session);
    Ok(())
}

#[tauri::command]
pub async fn llm_send_message(
    app_handle: AppHandle,
    state: tauri::State<'_, LlmManager>,
    id: String,
    messages_json: String,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions.get(&id).ok_or("Session not found")?;

    let provider = session.provider.clone();
    let model = session.model.clone();
    let base_url = session.base_url.clone();
    let api_key = session.api_key.clone();
    let system_prompt = session.system_prompt.clone();
    let temperature = session.temperature;
    let cancel = session.cancel.clone();

    let request = providers::build_request(
        &state.client,
        &provider,
        &base_url,
        api_key.as_deref(),
        &model,
        &messages_json,
        &system_prompt,
        temperature,
    )?;

    drop(sessions);

    let chunk_event = format!("llm-chunk-{}", id);
    let done_event = format!("llm-done-{}", id);
    let error_event = format!("llm-error-{}", id);

    let name = app_handle.try_state::<crate::panelbus::PanelBus>()
        .and_then(|bus| bus.with_registry(|r| r.get(&id).map(|p| p.name.clone())))
        .unwrap_or_else(|| id.clone());
    let mut record = Record::turn(format!("api:{}", uuid::Uuid::new_v4()),
        Actor { id: id.clone(), name, provider: provider.clone(), model: Some(model), device: None }, id.clone(), now());
    let messages: Vec<serde_json::Value> = serde_json::from_str(&messages_json).unwrap_or_default();
    record.set_prompt(messages.iter().rev().find(|m| m["role"] == "user").and_then(|m| m["content"].as_str()).unwrap_or("").to_string());
    record.status = "running".into();
    record_api(&app_handle, record.clone());
    tokio::spawn(async move {
        let mut cancelled = false;
        let result = async {
            use futures_util::StreamExt;

            let response = request
                .send()
                .await
                .map_err(|e| format!("Request failed: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "unknown".to_string());
                return Err(format!("HTTP {}: {}", status, body));
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            loop {
                tokio::select! {
                    _ = cancel.notified() => {
                        cancelled = true;
                        break;
                    }
                    chunk = stream.next() => {
                        match chunk {
                            Some(Ok(bytes)) => {
                                let text = String::from_utf8_lossy(&bytes);
                                buffer.push_str(&text);

                                while let Some(newline_pos) = buffer.find('\n') {
                                    let line = buffer[..newline_pos].trim().to_string();
                                    buffer = buffer[newline_pos + 1..].to_string();

                                    if line.is_empty() {
                                        continue;
                                    }

                                    if let Some(usage) = providers::parse_usage(&provider, &line, record.usage.as_ref()) {
                                        record.usage = Some(usage);
                                        record.updated_at = now();
                                        record_api(&app_handle, record.clone());
                                    }
                                    if let Some(content) = providers::parse_sse_chunk(&provider, &line) {
                                        record.response.push_str(&content);
                                        let _ = app_handle.emit(
                                            &chunk_event,
                                            ChunkPayload { content },
                                        );
                                    }
                                }
                            }
                            Some(Err(e)) => {
                                return Err(format!("Stream error: {}", e));
                            }
                            None => break,
                        }
                    }
                }
            }

            if !buffer.trim().is_empty() {
                if let Some(usage) = providers::parse_usage(&provider, buffer.trim(), record.usage.as_ref()) { record.usage = Some(usage); }
                if let Some(content) = providers::parse_sse_chunk(&provider, buffer.trim()) {
                    record.response.push_str(&content);
                    let _ = app_handle.emit(&chunk_event, ChunkPayload { content });
                }
            }
            Ok::<(), String>(())
        }
        .await;

        record.updated_at = now();
        record.status = if cancelled { "interrupted" } else if result.is_err() { "failed" } else { "completed" }.into();
        if record.usage.is_none() { record.usage_note = Some("Provider did not report token usage.".into()); }
        record_api(&app_handle, record);
        match result {
            Ok(()) => {
                let _ = app_handle.emit(&done_event, ());
            }
            Err(e) => {
                let _ = app_handle.emit(&error_event, ErrorPayload { error: e });
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn llm_cancel(
    id: String,
    state: tauri::State<'_, LlmManager>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    if let Some(session) = sessions.get(&id) {
        session.cancel.notify_one();
    }
    Ok(())
}

#[tauri::command]
pub async fn llm_destroy_session(
    id: String,
    state: tauri::State<'_, LlmManager>,
) -> Result<(), String> {
    state.sessions.lock().await.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn llm_list_models(
    provider: String,
    base_url: String,
    api_key: Option<String>,
    state: tauri::State<'_, LlmManager>,
) -> Result<Vec<String>, String> {
    let url = providers::list_models_url(&provider, &base_url);
    let mut req = state.client.get(&url);
    if let Some(key) = &api_key {
        if provider == "openai" || provider == "openrouter" {
            req = req.bearer_auth(key);
        } else if provider == "anthropic" {
            req = req
                .header("x-api-key", key.as_str())
                .header("anthropic-version", "2023-06-01");
        } else if provider == "gemini" {
            // Gemini uses query param for auth, already in URL for streaming
            // For model listing, append key
            let url_with_key = format!("{}?key={}", url, key);
            req = state.client.get(&url_with_key);
        }
    }
    let response = req
        .send()
        .await
        .map_err(|e| format!("Failed to list models: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    Ok(providers::parse_model_list(&provider, &body))
}

#[tauri::command]
pub async fn llm_check_connection(
    provider: String,
    base_url: String,
    state: tauri::State<'_, LlmManager>,
) -> Result<bool, String> {
    let url = match provider.as_str() {
        "openai" | "openrouter" | "lmstudio" | "anthropic" => {
            format!("{}/v1/models", base_url.trim_end_matches('/'))
        }
        "gemini" => format!("{}/v1beta/models", base_url.trim_end_matches('/')),
        "ollama" => format!("{}/api/tags", base_url.trim_end_matches('/')),
        _ => return Err(format!("Unknown provider: {}", provider)),
    };
    let result = state.client.get(&url).send().await;
    match result {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}
