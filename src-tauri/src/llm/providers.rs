use serde_json::Value;

const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Caps thinking + response text together. 16k leaves room for adaptive
/// thinking on every current model, Haiku 4.5's 64k ceiling included.
const ANTHROPIC_MAX_TOKENS: u32 = 16000;

pub fn build_request(
    client: &reqwest::Client,
    provider: &str,
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages_json: &str,
    system_prompt: &str,
    temperature: Option<f32>,
) -> Result<reqwest::RequestBuilder, String> {
    let mut messages: Vec<Value> =
        serde_json::from_str(messages_json).map_err(|e| format!("Invalid messages JSON: {}", e))?;

    // The session's system prompt lives outside the transcript — prepend it
    // unless the caller already supplied one.
    if !system_prompt.is_empty()
        && !messages
            .iter()
            .any(|m| m["role"].as_str() == Some("system"))
    {
        messages.insert(
            0,
            serde_json::json!({ "role": "system", "content": system_prompt }),
        );
    }

    match provider {
        // OpenRouter speaks the OpenAI chat-completions wire format; it only
        // adds optional attribution headers on top.
        "openai" | "openrouter" => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let mut body = serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            if let Some(temp) = temperature {
                body["temperature"] = serde_json::json!(temp);
            }
            let mut req = client.post(&url).json(&body);
            if provider == "openrouter" {
                req = req
                    .header("HTTP-Referer", "https://github.com/ahmetdenizyilmaz/tessera")
                    .header("X-Title", "Tessera");
            }
            if let Some(key) = api_key {
                req = req.bearer_auth(key);
            }
            Ok(req)
        }
        "lmstudio" => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let mut body = serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            if let Some(temp) = temperature {
                body["temperature"] = serde_json::json!(temp);
            }
            Ok(client.post(&url).json(&body))
        }
        // Anthropic Messages API — the plain-chat path, distinct from the
        // Claude Code CLI panels. System turns live in a top-level `system`
        // field rather than in `messages`.
        "anthropic" => {
            let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));

            let system: Vec<&str> = messages
                .iter()
                .filter(|m| m["role"].as_str() == Some("system"))
                .filter_map(|m| m["content"].as_str())
                .collect();
            let turns: Vec<&Value> = messages
                .iter()
                .filter(|m| m["role"].as_str() != Some("system"))
                .collect();

            let mut body = serde_json::json!({
                "model": model,
                "max_tokens": ANTHROPIC_MAX_TOKENS,
                "messages": turns,
                "stream": true,
            });
            if !system.is_empty() {
                body["system"] = Value::String(system.join("\n\n"));
            }

            // temperature is deliberately NOT forwarded here even when the
            // caller set one: current Claude models reject the parameter.
            Ok(client
                .post(&url)
                .header("x-api-key", api_key.unwrap_or(""))
                .header("anthropic-version", ANTHROPIC_VERSION)
                .json(&body))
        }
        "gemini" => {
            let url = format!(
                "{}/v1beta/models/{}:streamGenerateContent?key={}&alt=sse",
                base_url.trim_end_matches('/'),
                model,
                api_key.unwrap_or("")
            );
            let contents: Vec<Value> = messages
                .iter()
                .filter_map(|msg| {
                    let role = msg["role"].as_str()?;
                    let text = msg["content"].as_str()?;
                    let gemini_role = match role {
                        "assistant" => "model",
                        "system" => return None,
                        _ => "user",
                    };
                    Some(serde_json::json!({
                        "role": gemini_role,
                        "parts": [{"text": text}]
                    }))
                })
                .collect();
            let mut body = serde_json::json!({ "contents": contents });
            if let Some(temp) = temperature {
                body["generationConfig"] = serde_json::json!({ "temperature": temp });
            }
            // Add system instruction if present
            if let Some(sys) = messages.iter().find(|m| m["role"].as_str() == Some("system")) {
                if let Some(text) = sys["content"].as_str() {
                    body["systemInstruction"] = serde_json::json!({
                        "parts": [{"text": text}]
                    });
                }
            }
            Ok(client.post(&url).json(&body))
        }
        "ollama" => {
            let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
            let mut body = serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            if let Some(temp) = temperature {
                body["options"] = serde_json::json!({ "temperature": temp });
            }
            Ok(client.post(&url).json(&body))
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

pub fn parse_sse_chunk(provider: &str, line: &str) -> Option<String> {
    match provider {
        "openai" | "openrouter" | "lmstudio" => {
            let data = line.strip_prefix("data: ")?;
            if data == "[DONE]" {
                return None;
            }
            let json: Value = serde_json::from_str(data).ok()?;
            json.get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("delta"))
                .and_then(|d| d.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
        }
        "anthropic" => {
            let data = line.strip_prefix("data: ")?;
            let json: Value = serde_json::from_str(data).ok()?;
            match json.get("type").and_then(|t| t.as_str())? {
                // Only text_delta: thinking deltas carry no text unless
                // `display: summarized` is requested, and an API error
                // mid-stream arrives as its own event type.
                "content_block_delta" => json
                    .get("delta")
                    .filter(|d| d.get("type").and_then(|t| t.as_str()) == Some("text_delta"))
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string()),
                "error" => {
                    let msg = json
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("unknown error");
                    Some(format!("\n\n[Anthropic API error: {}]", msg))
                }
                _ => None,
            }
        }
        "gemini" => {
            let data = line.strip_prefix("data: ")?;
            let json: Value = serde_json::from_str(data).ok()?;
            json.get("candidates")
                .and_then(|c| c.get(0))
                .and_then(|c| c.get("content"))
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.get(0))
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        }
        "ollama" => {
            // NDJSON: each line is a full JSON object
            let json: Value = serde_json::from_str(line).ok()?;
            if json.get("done").and_then(|d| d.as_bool()) == Some(true) {
                return None;
            }
            json.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string())
        }
        _ => None,
    }
}

pub fn list_models_url(provider: &str, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    match provider {
        "openai" | "openrouter" | "lmstudio" | "anthropic" => format!("{}/v1/models", base),
        "gemini" => format!("{}/v1beta/models", base),
        "ollama" => format!("{}/api/tags", base),
        _ => format!("{}/v1/models", base),
    }
}

pub fn parse_model_list(provider: &str, body_json: &Value) -> Vec<String> {
    match provider {
        // OpenRouter's catalog is huge; surface the zero-cost ":free" routes
        // first so they're one click away, each group alphabetical.
        "openrouter" => {
            let mut ids: Vec<String> = body_json["data"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            ids.sort_by(|a, b| {
                let fa = a.ends_with(":free");
                let fb = b.ends_with(":free");
                fb.cmp(&fa).then_with(|| a.cmp(b))
            });
            ids
        }
        "openai" | "lmstudio" | "anthropic" => body_json["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        "gemini" => body_json["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        m["name"]
                            .as_str()
                            .map(|s| s.strip_prefix("models/").unwrap_or(s).to_string())
                    })
                    .collect()
            })
            .unwrap_or_default(),
        "ollama" => body_json["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        _ => vec![],
    }
}
