use serde_json::Value;

pub fn build_request(
    client: &reqwest::Client,
    provider: &str,
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages_json: &str,
) -> Result<reqwest::RequestBuilder, String> {
    let messages: Vec<Value> =
        serde_json::from_str(messages_json).map_err(|e| format!("Invalid messages JSON: {}", e))?;

    match provider {
        "openai" => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let body = serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            let mut req = client.post(&url).json(&body);
            if let Some(key) = api_key {
                req = req.bearer_auth(key);
            }
            Ok(req)
        }
        "lmstudio" => {
            let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
            let body = serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            Ok(client.post(&url).json(&body))
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
            let body = serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            });
            Ok(client.post(&url).json(&body))
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

pub fn parse_sse_chunk(provider: &str, line: &str) -> Option<String> {
    match provider {
        "openai" | "lmstudio" => {
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
        "openai" | "lmstudio" => format!("{}/v1/models", base),
        "gemini" => format!("{}/v1beta/models", base),
        "ollama" => format!("{}/api/tags", base),
        _ => format!("{}/v1/models", base),
    }
}

pub fn parse_model_list(provider: &str, body_json: &Value) -> Vec<String> {
    match provider {
        "openai" | "lmstudio" => body_json["data"]
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
