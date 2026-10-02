//! Pure transcript reducer for `agy --output-format stream-json`.
//!
//! Verified against agy 1.2.15: `init` arrives once per process, `step_update`
//! carries deltas keyed by a conversation-wide `step_index`, and `result` ends
//! a turn with usage that is cumulative for the whole conversation. The CLI
//! does not replay earlier steps on resume, so Tessera keeps this transcript.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const MAX_SAVED_ITEMS: usize = 4000;

/// Token counts exactly as the CLI reports them. `thinking` is part of
/// `output`; normalization for Activity happens in `activity::model::Usage`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: u64,
    pub output: u64,
    pub thinking: u64,
    pub cache_read: u64,
    pub total: u64,
}
impl TokenUsage {
    pub fn parse(v: &Value) -> Option<Self> {
        Some(Self {
            input: v["input_tokens"].as_u64()?,
            output: v["output_tokens"].as_u64().unwrap_or(0),
            thinking: v["thinking_tokens"].as_u64().unwrap_or(0),
            cache_read: v["cache_read_tokens"].as_u64().unwrap_or(0),
            total: v["total_tokens"].as_u64().unwrap_or(0),
        })
    }
    pub fn add(&mut self, other: &Self) {
        self.input += other.input;
        self.output += other.output;
        self.thinking += other.thinking;
        self.cache_read += other.cache_read;
        self.total += other.total;
    }
    /// Back to the CLI's field names, for the Activity recorder.
    pub fn wire(&self) -> Value {
        json!({"input_tokens":self.input,"output_tokens":self.output,"thinking_tokens":self.thinking,
            "cache_read_tokens":self.cache_read,"total_tokens":self.total})
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    /// user | assistant | tool | notice | result
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    /// active | done | error | interrupted
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub state: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub parameters: Value,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub output: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub error: String,
    /// notice: error | warning | info | denied. result: completed | failed | interrupted.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub level: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(default)]
    pub at: i64,
}
impl Item {
    fn new(id: String, kind: &str, at: i64) -> Self {
        Self {
            id,
            kind: kind.into(),
            at,
            ..Self::default()
        }
    }
    fn notice(level: &str, text: impl Into<String>, at: i64) -> Self {
        Self {
            level: level.into(),
            text: text.into(),
            ..Self::new(format!("n-{}", uuid::Uuid::new_v4()), "notice", at)
        }
    }
    fn settled(&self) -> bool {
        matches!(self.state.as_str(), "done" | "error" | "interrupted")
    }
}

pub struct Turn {
    pub id: String,
    pub started_at: i64,
    /// The user pressed Stop; a process exit is then an interruption, not a crash.
    pub cancelled: bool,
    /// `turn_started` reached Activity, so its end must be reported too.
    pub announced: bool,
    /// Keyed by step index: a repeated DONE event replaces instead of adding.
    step_usage: BTreeMap<u64, TokenUsage>,
    denied: Vec<String>,
    first_item: usize,
}

/// Activity/Office side effects of one stream event.
#[derive(Debug, PartialEq)]
pub enum Effect {
    Tool { name: String, active: bool },
    Response { step: u64, text: String },
}

/// What the Activity recorder needs when a turn ends.
#[derive(Debug, PartialEq)]
pub struct Finished {
    pub turn: String,
    pub announced: bool,
    /// completed | failed | interrupted
    pub status: String,
    pub error: String,
    pub response: String,
    /// Conversation-wide counter from `result.usage`; absent when the turn never reported one.
    pub cumulative: Option<TokenUsage>,
    /// Sum of the per-step usage observed during this turn only.
    pub steps: Option<TokenUsage>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    #[serde(default)]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub cumulative: Option<TokenUsage>,
}

#[derive(Default)]
pub struct Transcript {
    pub items: Vec<Item>,
    pub turn: Option<Turn>,
    /// Last conversation-wide usage the CLI reported.
    pub cumulative: Option<TokenUsage>,
    /// `result.denied_actions` accumulates per process; remember how many were shown.
    denied_seen: usize,
}

/// Activity and the office use a small shared tool vocabulary.
pub fn office_tool(name: &str) -> &str {
    match name {
        "run_command" | "send_command_input" | "command_status" => "Bash",
        "write_to_file" => "Write",
        "replace_file_content" | "multi_replace_file_content" | "sed_file" | "notebook_edit" => {
            "Edit"
        }
        "view_file" | "read_resource" | "list_resources" => "Read",
        "grep_search" | "find_by_name" | "list_dir" => "Grep",
        "search_web" => "WebSearch",
        "invoke_subagent" | "define_subagent" | "manage_subagents" | "browser_subagent" => "Agent",
        "manage_task" | "schedule" => "TodoWrite",
        "call_mcp_tool" => "MCP",
        n if n == "read_url_content" || n.contains("browser") => "WebFetch",
        other => other,
    }
}

fn status_of(raw: &str) -> &'static str {
    match raw {
        "SUCCESS" | "WAITING" => "completed",
        "CANCELED" | "INTERRUPTED" => "interrupted",
        _ => "failed",
    }
}

impl Transcript {
    pub fn restore(saved: Saved) -> Self {
        let mut items = saved.items;
        // A previous run ended mid-turn (crash or forced exit): nothing is streaming now.
        for item in &mut items {
            if item.state == "active" {
                item.state = "interrupted".into();
            }
        }
        Self {
            items,
            cumulative: saved.cumulative,
            ..Self::default()
        }
    }
    pub fn save(&self, conversation_id: Option<String>) -> Saved {
        let skip = self.items.len().saturating_sub(MAX_SAVED_ITEMS);
        Saved {
            conversation_id,
            items: self.items[skip..].to_vec(),
            cumulative: self.cumulative.clone(),
        }
    }
    pub fn process_started(&mut self) {
        self.denied_seen = 0;
    }
    pub fn busy(&self) -> bool {
        self.turn.is_some()
    }
    pub fn note(&mut self, level: &str, text: impl Into<String>, at: i64) {
        self.items.push(Item::notice(level, text, at));
    }

    pub fn begin_turn(&mut self, text: &str, at: i64) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.items.push(Item {
            text: text.into(),
            ..Item::new(format!("u-{id}"), "user", at)
        });
        self.turn = Some(Turn {
            id: id.clone(),
            started_at: at,
            cancelled: false,
            announced: false,
            step_usage: BTreeMap::new(),
            denied: vec![],
            first_item: self.items.len(),
        });
        id
    }

    /// The CLI explains an auto-denied tool only on stderr.
    pub fn stderr(&mut self, line: &str, at: i64) {
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        let lower = line.to_lowercase();
        if lower.contains("auto-denied") || lower.contains("denied permission") {
            if !turn.denied.iter().any(|known| known == line) {
                turn.denied.push(line.into());
            }
        } else if lower.starts_with("warning:") {
            self.items.push(Item::notice("warning", line, at));
        }
    }

    pub fn step(&mut self, conversation: &str, step: &Value, at: i64) -> Vec<Effect> {
        let Some(turn) = self.turn.as_mut() else {
            return vec![];
        };
        let Some(index) = step["step_index"].as_u64() else {
            return vec![];
        };
        if let Some(usage) = TokenUsage::parse(&step["usage"]) {
            turn.step_usage.insert(index, usage);
        }
        let kind = match step["step_type"].as_str() {
            Some("agent_response") => "assistant",
            Some("tool") => "tool",
            // user_input echoes our own send; checkpoints and system messages carry no content.
            _ => return vec![],
        };
        let state = match step["state"].as_str() {
            Some("DONE") => "done",
            Some("ERROR") => "error",
            _ => "active",
        };
        let id = format!("{}-{index}", conversation.chars().take(8).collect::<String>());
        let delta = step["text_delta"].as_str().unwrap_or("");
        let position = self.items[turn.first_item.min(self.items.len())..]
            .iter()
            .position(|item| item.id == id)
            .map(|offset| offset + turn.first_item.min(self.items.len()));
        let position = match position {
            Some(position) => position,
            // A response step that only called tools has no text: nothing to show yet.
            None if kind == "assistant" && delta.is_empty() => return vec![],
            None => {
                self.items.push(Item::new(id, kind, at));
                self.items.len() - 1
            }
        };
        let item = &mut self.items[position];
        // The same DONE event can be delivered twice; never append its delta again.
        if item.settled() {
            return vec![];
        }
        item.state = state.into();
        if let Some(seconds) = step["duration_seconds"].as_f64() {
            item.duration_seconds = Some(seconds);
        }
        if kind == "assistant" {
            item.text.push_str(delta);
            item.usage = TokenUsage::parse(&step["usage"]).or(item.usage.take());
            return vec![Effect::Response {
                step: index,
                text: item.text.clone(),
            }];
        }
        let info = &step["tool_info"];
        let name = step["tool_name"]
            .as_str()
            .or_else(|| info["name"].as_str())
            .unwrap_or("tool");
        item.name = name.into();
        if !info["parameters"].is_null() {
            item.parameters = info["parameters"].clone();
        } else if !step["subagent_info"].is_null() {
            item.parameters = step["subagent_info"].clone();
        }
        if let Some(output) = info["output"].as_str() {
            item.output = output.into();
        }
        if !info["error"].is_null() {
            item.error = info["error"]["message"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| info["error"].to_string());
            let lower = item.error.to_lowercase();
            if lower.contains("denied") || lower.contains("permission check failed") {
                let line = format!("{name}: {}", item.error.lines().next().unwrap_or(""));
                if !turn.denied.contains(&line) {
                    turn.denied.push(line);
                }
            }
        }
        vec![Effect::Tool {
            name: office_tool(name).into(),
            active: state == "active",
        }]
    }

    /// Close the active turn. `raw_status` is the CLI's own word, kept for display.
    fn close(
        &mut self,
        status: &str,
        raw_status: &str,
        error: &str,
        response: &str,
        cumulative: Option<TokenUsage>,
        denied_actions: &[String],
        at: i64,
    ) -> Option<Finished> {
        let turn = self.turn.take()?;
        let first = turn.first_item.min(self.items.len());
        for item in &mut self.items[first..] {
            if item.state == "active" {
                item.state = if status == "completed" {
                    "done"
                } else {
                    "interrupted"
                }
                .into();
            }
        }
        let streamed = self.items[first..]
            .iter()
            .filter(|item| item.kind == "assistant")
            .map(|item| item.text.trim_end())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        // Print mode can return the answer only in the final result.
        if streamed.is_empty() && !response.trim().is_empty() {
            self.items.push(Item {
                text: response.into(),
                state: "done".into(),
                ..Item::new(format!("r-{}", turn.id), "assistant", at)
            });
        }
        if !turn.denied.is_empty() || denied_actions.len() > self.denied_seen {
            self.items.push(Item {
                error: turn.denied.join("\n"),
                ..Item::notice("denied", denied_actions.join(", "), at)
            });
        }
        if !denied_actions.is_empty() {
            self.denied_seen = denied_actions.len();
        }
        if !error.is_empty() {
            self.items.push(Item::notice(
                if status == "interrupted" {
                    "info"
                } else {
                    "error"
                },
                error,
                at,
            ));
        }
        let steps = (!turn.step_usage.is_empty()).then(|| {
            let mut sum = TokenUsage::default();
            turn.step_usage.values().for_each(|usage| sum.add(usage));
            sum
        });
        if let Some(total) = &cumulative {
            // An error result before any model call reports zeros; keep the known counter.
            if total.total > 0 || self.cumulative.is_none() {
                self.cumulative = Some(total.clone());
            }
        }
        self.items.push(Item {
            level: status.into(),
            text: raw_status.into(),
            usage: steps.clone(),
            duration_seconds: Some((at - turn.started_at).max(0) as f64 / 1000.0),
            ..Item::new(format!("t-{}", turn.id), "result", at)
        });
        Some(Finished {
            turn: turn.id,
            announced: turn.announced,
            status: status.into(),
            error: error.into(),
            response: if streamed.is_empty() {
                response.trim_end().into()
            } else {
                streamed
            },
            cumulative,
            steps,
        })
    }

    pub fn result(&mut self, result: &Value, at: i64) -> Option<Finished> {
        let raw = result["status"].as_str().unwrap_or("ERROR");
        let denied: Vec<String> = result["denied_actions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|action| {
                action["display_name"]
                    .as_str()
                    .or_else(|| action["action"].as_str())
                    .map(String::from)
            })
            .collect();
        self.close(
            status_of(raw),
            raw,
            result["error"].as_str().unwrap_or(""),
            result["response"].as_str().unwrap_or(""),
            TokenUsage::parse(&result["usage"]),
            &denied,
            at,
        )
    }

    /// The process ended (or never started) without a `result` for the active turn.
    pub fn abort(&mut self, cancelled: bool, message: &str, at: i64) -> Option<Finished> {
        let (status, raw) = if cancelled {
            ("interrupted", "STOPPED")
        } else {
            ("failed", "FAILED")
        };
        self.close(status, raw, message, "", None, &[], at)
    }

    /// Text turns, oldest first, for forks and cross-panel reads.
    pub fn messages(&self, limit: usize) -> Vec<Value> {
        let rows: Vec<Value> = self
            .items
            .iter()
            .filter(|item| matches!(item.kind.as_str(), "user" | "assistant") && !item.text.trim().is_empty())
            .map(|item| json!({"role":item.kind,"content":item.text.trim_end()}))
            .collect();
        rows[rows.len().saturating_sub(limit)..].to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONV: &str = "74b2286b-bb93-41f1-9263-47fd8aa9c584";
    fn step(json: Value) -> Value {
        json
    }
    fn usage(input: u64, output: u64, thinking: u64) -> Value {
        json!({"input_tokens":input,"output_tokens":output,"thinking_tokens":thinking,"cache_read_tokens":0,"total_tokens":input+output})
    }

    /// Event shapes recorded from agy 1.2.15 (a tool-only response, a write, a
    /// denied command reported as ERROR, and a denied command reported as DONE).
    #[test]
    fn real_tool_turn_keeps_order_usage_and_denials() {
        let mut t = Transcript::default();
        let turn = t.begin_turn("Create note.txt and run two commands", 1_000);
        assert!(t.busy());
        assert!(t
            .step(CONV, &step(json!({"step_index":0,"state":"DONE","step_type":"user_input"})), 1_010)
            .is_empty());
        // No text: recorded for usage, but no empty bubble.
        assert!(t.step(CONV, &step(json!({"step_index":1,"state":"DONE","step_type":"agent_response","duration_seconds":3.48,"usage":usage(12529,699,330)})), 1_020).is_empty());
        assert_eq!(t.items.len(), 1);
        let write = json!({"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"write_to_file","tool_info":{"name":"write_to_file","parameters":{"TargetFile":"C:\\work\\note.txt"}}});
        assert_eq!(
            t.step(CONV, &write, 1_030),
            vec![Effect::Tool {
                name: "Write".into(),
                active: true
            }]
        );
        let mut done = write.clone();
        done["state"] = json!("DONE");
        done["duration_seconds"] = json!(0.24);
        assert_eq!(
            t.step(CONV, &done, 1_040),
            vec![Effect::Tool {
                name: "Write".into(),
                active: false
            }]
        );
        t.stderr("jetski: no output produced — a tool required the \"command\" permission that headless mode cannot prompt for, so it was auto-denied.", 1_045);
        t.step(CONV, &json!({"step_index":3,"state":"ERROR","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"Get-ChildItem"},
            "error":{"type":"TOOL_ERROR","message":"permission check failed for command \"Get-ChildItem\": user denied permission to run command:\nGet-ChildItem"}}}), 1_050);
        t.step(CONV, &json!({"step_index":4,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo tessera-probe"}}}), 1_060);
        let finished = t
            .result(&json!({"conversation_id":CONV,"status":"SUCCESS","response":"","duration_seconds":3.54,"num_turns":1,
                "usage":usage(12529,699,330),"denied_actions":[{"action":"command","display_name":"RunCommand"}]}), 4_500)
            .unwrap();
        assert_eq!(finished.turn, turn);
        assert_eq!(finished.status, "completed");
        assert_eq!(finished.steps.as_ref().unwrap().total, 13228);
        assert_eq!(finished.cumulative.as_ref().unwrap().total, 13228);
        assert!(!t.busy());
        let kinds: Vec<_> = t
            .items
            .iter()
            .map(|item| (item.kind.as_str(), item.state.as_str(), item.level.as_str()))
            .collect();
        assert_eq!(
            kinds,
            vec![
                ("user", "", ""),
                ("tool", "done", ""),
                ("tool", "error", ""),
                ("tool", "done", ""),
                ("notice", "", "denied"),
                ("result", "", "completed")
            ]
        );
        assert_eq!(t.items[1].id, "74b2286b-2");
        assert!(t.items[2].error.contains("user denied permission"));
        assert_eq!(t.items[4].text, "RunCommand");
        assert!(t.items[4].error.contains("auto-denied"));
        assert_eq!(t.items[5].duration_seconds, Some(3.5));

        // Turn 2 in the same process: the cumulative list repeats the earlier denial.
        t.begin_turn("What was the word?", 5_000);
        t.step(CONV, &json!({"step_index":6,"state":"ACTIVE","step_type":"agent_response","text_delta":"marzipan"}), 5_100);
        t.step(CONV, &json!({"step_index":6,"state":"DONE","step_type":"agent_response","text_delta":"\n","usage":usage(13708,38,35)}), 5_200);
        let second = t
            .result(&json!({"status":"SUCCESS","response":"marzipan\n","usage":usage(26237,737,365),"denied_actions":[{"action":"command","display_name":"RunCommand"}]}), 5_300)
            .unwrap();
        assert_eq!(second.response, "marzipan");
        assert_eq!(second.steps.unwrap().total, 13746);
        assert_eq!(second.cumulative.unwrap().total, 26974);
        assert_eq!(
            t.items.iter().filter(|item| item.level == "denied").count(),
            1,
            "an old denial must not be reported again"
        );
        assert_eq!(t.messages(10), vec![
            json!({"role":"user","content":"Create note.txt and run two commands"}),
            json!({"role":"user","content":"What was the word?"}),
            json!({"role":"assistant","content":"marzipan"}),
        ]);
    }

    #[test]
    fn duplicate_events_do_not_repeat_text_or_usage() {
        let mut t = Transcript::default();
        t.begin_turn("hi", 0);
        let active = json!({"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"pong"});
        let done = json!({"step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"\n","usage":usage(100,5,2)});
        t.step(CONV, &active, 1);
        t.step(CONV, &done, 2);
        assert!(t.step(CONV, &done, 3).is_empty());
        assert!(t.step(CONV, &active, 4).is_empty());
        assert_eq!(t.items[1].text, "pong\n");
        let finished = t
            .result(&json!({"status":"SUCCESS","response":"pong\n","usage":usage(100,5,2)}), 5)
            .unwrap();
        assert_eq!(finished.steps.unwrap().total, 105);
        // A second result for the same turn has nothing left to close.
        assert!(t.result(&json!({"status":"SUCCESS","usage":usage(100,5,2)}), 6).is_none());
        assert_eq!(t.items.iter().filter(|item| item.kind == "result").count(), 1);
        // Events outside a turn (late output from a stopped process) are ignored.
        assert!(t.step(CONV, &json!({"step_index":9,"state":"ACTIVE","step_type":"agent_response","text_delta":"late"}), 7).is_empty());
        assert_eq!(t.items.len(), 3);
    }

    #[test]
    fn stopped_and_crashed_turns_settle_partial_output_without_inventing_usage() {
        let mut t = Transcript::default();
        t.begin_turn("Write an essay", 0);
        t.step(CONV, &json!({"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"For centuries"}), 10);
        t.turn.as_mut().unwrap().cancelled = true;
        let stopped = t.abort(true, "Stopped.", 2_000).unwrap();
        assert_eq!(stopped.status, "interrupted");
        assert_eq!((stopped.cumulative, stopped.steps), (None, None));
        assert_eq!(stopped.response, "For centuries");
        assert_eq!(t.items[1].state, "interrupted");
        assert_eq!(t.items.last().unwrap().level, "interrupted");
        assert!(t.items.last().unwrap().usage.is_none());

        t.begin_turn("Again", 3_000);
        t.step(CONV, &json!({"step_index":3,"state":"DONE","step_type":"agent_response","usage":usage(50,5,0)}), 3_010);
        t.step(CONV, &json!({"step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"grep_search"}), 3_020);
        let crashed = t.abort(false, "Antigravity exited unexpectedly (exit code 1).", 3_500).unwrap();
        assert_eq!(crashed.status, "failed");
        assert_eq!(crashed.steps.unwrap().total, 55);
        assert_eq!(t.items.iter().rev().nth(1).unwrap().level, "error");
        assert!(t.abort(false, "again", 3_600).is_none());
    }

    #[test]
    fn error_results_and_final_only_responses_are_shown() {
        let mut t = Transcript::default();
        t.begin_turn("hi", 0);
        let failed = t
            .result(&json!({"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection","usage":usage(0,0,0)}), 10)
            .unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.error, "invalid model selection");
        assert_eq!(t.items[1].level, "error");
        assert_eq!(t.cumulative.as_ref().unwrap().total, 0);

        t.cumulative = Some(TokenUsage { input: 90, output: 10, total: 100, ..Default::default() });
        t.begin_turn("again", 20);
        t.result(&json!({"status":"ERROR","error":"quota","usage":usage(0,0,0)}), 30);
        assert_eq!(t.cumulative.as_ref().unwrap().total, 100, "a zero error report must not reset the counter");

        t.begin_turn("final only", 40);
        let done = t.result(&json!({"status":"SUCCESS","response":"Only in result\n","usage":usage(200,20,0)}), 50).unwrap();
        assert_eq!(done.response, "Only in result");
        assert!(done.steps.is_none());
        assert_eq!(t.items.iter().rev().nth(1).unwrap().text, "Only in result\n");
    }

    #[test]
    fn saved_transcripts_restore_without_a_streaming_item() {
        let mut t = Transcript::default();
        t.begin_turn("q", 0);
        t.step(CONV, &json!({"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"partial"}), 1);
        let text = serde_json::to_string(&t.save(Some(CONV.into()))).unwrap();
        let saved: Saved = serde_json::from_str(&text).unwrap();
        assert_eq!(saved.conversation_id.as_deref(), Some(CONV));
        let restored = Transcript::restore(saved);
        assert!(!restored.busy());
        assert_eq!(restored.items[1].state, "interrupted");
        assert_eq!(restored.items[1].text, "partial");
    }

    #[test]
    fn tool_names_map_to_the_shared_office_vocabulary() {
        for (name, expected) in [
            ("run_command", "Bash"),
            ("write_to_file", "Write"),
            ("multi_replace_file_content", "Edit"),
            ("view_file", "Read"),
            ("list_dir", "Grep"),
            ("search_web", "WebSearch"),
            ("browser_click_element", "WebFetch"),
            ("browser_subagent", "Agent"),
            ("some_future_tool", "some_future_tool"),
        ] {
            assert_eq!(office_tool(name), expected);
        }
    }
}
