//! Incremental transcript reader, shared by Claude chat and terminal panels.
use super::model::*;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Default, Clone)]
pub struct Transcript {
    pub path: PathBuf,
    pub actor: Option<Actor>,
    offset: u64,
    current: Option<Record>,
    usage: HashMap<String, Usage>,
    parts: Vec<(String, String)>,
    caught_up: bool,
}

impl Transcript {
    pub fn current_id(&self) -> Option<String> {
        if self.caught_up {
            self.current.as_ref().map(|r| r.id.clone())
        } else {
            None
        }
    }
    pub fn read(
        &mut self,
        path: &Path,
        actor: &Actor,
        session: &str,
    ) -> Result<Vec<Record>, String> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        let size = file.metadata().map_err(|e| e.to_string())?.len();
        if self.path != path || size < self.offset {
            *self = Self {
                path: path.into(),
                ..Self::default()
            };
        }
        self.actor = Some(actor.clone());
        let mut reader = BufReader::new(file);
        reader
            .seek(SeekFrom::Start(self.offset))
            .map_err(|e| e.to_string())?;
        let mut changed = HashMap::new();
        let mut line = Vec::new();
        let start = self.offset;
        while self.offset - start < 8 * 1024 * 1024 {
            line.clear();
            let count = reader
                .read_until(b'\n', &mut line)
                .map_err(|e| e.to_string())?;
            // A writer may be halfway through its final line. Retry it next scan.
            if count == 0 || !line.ends_with(b"\n") {
                break;
            }
            self.offset += count as u64;
            if let Ok(value) = serde_json::from_slice::<Value>(&line) {
                for record in self.consume(&value, actor, session) {
                    changed.insert(record.id.clone(), record);
                }
            }
        }
        self.caught_up = self.offset >= size;
        Ok(changed.into_values().collect())
    }

    pub fn consume(&mut self, v: &Value, actor: &Actor, session: &str) -> Vec<Record> {
        if v["isMeta"] == true || v["isSidechain"] == true || v["isCompactSummary"] == true {
            return vec![];
        }
        let kind = v["type"].as_str().unwrap_or("");
        if kind != "user" && kind != "assistant" {
            return vec![];
        }
        let Some(at) = timestamp(&v["timestamp"]) else {
            return vec![];
        };
        let text = text_content(&v["message"]["content"]);
        if kind == "user" {
            if text.is_empty()
                || text.starts_with("<command-")
                || text.starts_with("<local-command-")
                || text.starts_with("<task-notification>")
            {
                return vec![];
            }
            // Tool results carry the user role, but do not begin a human turn.
            if v["message"]["content"]
                .as_array()
                .is_some_and(|a| a.iter().any(|b| b["type"] == "tool_result"))
            {
                return vec![];
            }
            let Some(uuid) = v["uuid"].as_str() else {
                return vec![];
            };
            let id = format!("claude:{session}:{uuid}");
            if self.current.as_ref().is_some_and(|r| r.id == id) {
                return vec![];
            }
            let mut previous = vec![];
            if let Some(record) = self.current.take() {
                previous.push(record);
            }
            let mut record = Record::turn(id, actor.clone(), session.into(), at);
            record.set_prompt(text);
            self.current = Some(record.clone());
            self.usage.clear();
            self.parts.clear();
            previous.push(record);
            return previous;
        }
        let Some(record) = self.current.as_mut() else {
            return vec![];
        };
        // Repeated content blocks share a message ID and report the same input
        // usage. Replace that message's counters instead of summing each block.
        if let Some(id) = v["message"]["id"].as_str() {
            if let Some(usage) = Usage::claude(&v["message"]["usage"]) {
                self.usage.insert(id.into(), usage);
            }
        }
        if !text.is_empty() {
            if let Some(id) = v["uuid"].as_str().or(v["message"]["id"].as_str()) {
                if let Some(part) = self.parts.iter_mut().find(|(key, _)| key == id) {
                    part.1 = text;
                } else {
                    self.parts.push((id.into(), text));
                }
            }
        }
        record.actor = actor.clone();
        if let Some(model) = v["message"]["model"].as_str() {
            record.actor.model = Some(model.into());
        }
        record.updated_at = at;
        record.response = self
            .parts
            .iter()
            .map(|(_, text)| text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        record.usage = if self.usage.is_empty() {
            None
        } else {
            let mut total = Usage::default();
            for usage in self.usage.values() {
                total.add(usage);
            }
            Some(total)
        };
        if v["message"]["stop_reason"] == "end_turn" {
            record.status = "completed".into();
        }
        vec![record.clone()]
    }
}
