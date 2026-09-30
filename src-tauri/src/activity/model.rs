use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Uncached input. Codex includes cached input in inputTokens; normalize it here.
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// A subset of output, never added to the total a second time.
    pub reasoning: u64,
}
impl Usage {
    pub fn add(&mut self, other: &Self) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
        self.reasoning += other.reasoning;
    }
    pub fn codex(v: &Value) -> Option<Self> {
        let reported_input = v["inputTokens"].as_u64()?;
        let output = v["outputTokens"].as_u64().unwrap_or(0);
        let input = v["totalTokens"]
            .as_u64()
            .map(|total| total.saturating_sub(output))
            .unwrap_or(reported_input);
        let cache = v["cachedInputTokens"].as_u64().unwrap_or(0).min(input);
        let write = v["cacheWriteInputTokens"]
            .as_u64()
            .unwrap_or(0)
            .min(input - cache);
        Some(Self {
            input: input - cache - write,
            output,
            cache_read: cache,
            cache_write: write,
            reasoning: v["reasoningOutputTokens"].as_u64().unwrap_or(0),
        })
    }
    pub fn claude(v: &Value) -> Option<Self> {
        Some(Self {
            input: v["input_tokens"].as_u64()?,
            output: v["output_tokens"].as_u64().unwrap_or(0),
            cache_read: v["cache_read_input_tokens"].as_u64().unwrap_or(0),
            cache_write: v["cache_creation_input_tokens"].as_u64().unwrap_or(0),
            ..Self::default()
        })
    }
    pub fn delta(&self, previous: &Self) -> Self {
        Self {
            input: self.input.saturating_sub(previous.input),
            output: self.output.saturating_sub(previous.output),
            cache_read: self.cache_read.saturating_sub(previous.cache_read),
            cache_write: self.cache_write.saturating_sub(previous.cache_write),
            reasoning: self.reasoning.saturating_sub(previous.reasoning),
        }
    }
    pub fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model: Option<String>,
    pub device: Option<String>,
}
impl Actor {
    pub fn panel(panel: &crate::panelbus::registry::PanelInfo) -> Self {
        Self {
            id: panel.id.clone(),
            name: panel.name.clone(),
            provider: panel.provider.clone().unwrap_or_else(|| "claude".into()),
            model: panel.model.clone(),
            device: panel.device_name.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub kind: String,
    pub actor: Actor,
    pub target: Option<Actor>,
    pub session_id: String,
    pub started_at: i64,
    pub updated_at: i64,
    pub status: String,
    pub prompt: String,
    pub response: String,
    pub usage: Option<Usage>,
    /// ID of the recorded handoff that caused this turn, or the sender turn for a handoff.
    pub parent_id: Option<String>,
    pub usage_note: Option<String>,
    #[serde(default)]
    pub response_parts: Vec<(String, String)>,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub prompt_parts: Vec<Prompt>,
    /// Tool names only: used to animate the office and reward different work categories.
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub current_tool: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Prompt {
    pub id: String,
    pub text: String,
    pub at: i64,
}
impl Record {
    pub fn turn(id: String, actor: Actor, session_id: String, at: i64) -> Self {
        Self {
            id,
            kind: "turn".into(),
            actor,
            target: None,
            session_id,
            started_at: at,
            updated_at: at,
            status: "recorded".into(),
            prompt: String::new(),
            response: String::new(),
            usage: None,
            parent_id: None,
            usage_note: None,
            response_parts: vec![],
            origin: "user".into(),
            prompt_parts: vec![],
            tools: vec![],
            current_tool: None,
        }
    }
    pub fn set_prompt(&mut self, text: String) {
        if let Some((trace, message)) = trace_message(&text) {
            self.parent_id = Some(trace);
            self.prompt = message;
            self.origin = "panel".into();
        } else {
            self.origin = if text.starts_with("[panel-message from ") {
                "panel"
            } else {
                "user"
            }
            .into();
            self.prompt = text;
        }
    }
}

pub fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
pub fn timestamp(v: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(v.as_str()?)
        .ok()
        .map(|t| t.timestamp_millis())
}
pub fn text_content(value: &Value) -> String {
    if let Some(s) = value.as_str() {
        return s.to_string();
    }
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|b| match b["type"].as_str() {
                    Some("text" | "input_text" | "output_text") => {
                        b["text"].as_str().map(String::from)
                    }
                    Some("image" | "input_image" | "localImage") => Some("[Image]".into()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// A trace is transport metadata added by Tessera, not inferred from agent prose.
pub fn trace_message(text: &str) -> Option<(String, String)> {
    let header = text.lines().next()?;
    if !header.starts_with("[panel-message from ") {
        return None;
    }
    let (_, suffix) = header.rsplit_once(" · activity ")?;
    let id = suffix.strip_suffix(']')?;
    uuid::Uuid::parse_str(id).ok()?;
    Some((
        format!("handoff:{id}"),
        text.split_once('\n')
            .map(|(_, message)| message)
            .unwrap_or("")
            .to_string(),
    ))
}
