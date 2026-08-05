//! Rust-side mirror of the panel list.
//!
//! Panel names, colours and kinds live only in the frontend's zustand stores,
//! but the MCP server has to answer `list_panels` even when the window is
//! minimised, reloading, or when the target panel's React tree was never
//! mounted at all (panels inside a collapsed group render as a preview, so
//! their `ChatView` never mounts). So the frontend pushes a snapshot here from
//! the app root and the server reads only from this mirror.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelInfo {
    pub id: String,
    pub name: String,
    pub cwd: String,
    /// "chat" | "terminal" | "llm"
    pub kind: String,
    /// starting | running | stopped | error
    pub status: String,
    /// Mid-turn right now.
    #[serde(default)]
    pub busy: bool,
    /// Blocked on a permission card / question the user has to answer.
    #[serde(default)]
    pub awaiting_user: bool,
    pub model: Option<String>,
    /// Claude's session id as the frontend last saw it. Only a fallback —
    /// the stream manager holds the authoritative value.
    #[serde(default)]
    pub session_id: Option<String>,
}

impl PanelInfo {
    /// Whether `send_to_panel` can deliver here at all. LLM panels run against
    /// a provider API, not a Claude Code process, so there is nothing to write
    /// a user turn into.
    pub fn reachable(&self) -> bool {
        self.kind == "chat" || self.kind == "terminal"
    }
}

#[derive(Default)]
pub struct PanelRegistry {
    panels: HashMap<String, PanelInfo>,
}

impl PanelRegistry {
    pub fn replace_all(&mut self, panels: Vec<PanelInfo>) {
        self.panels = panels.into_iter().map(|p| (p.id.clone(), p)).collect();
    }

    pub fn get(&self, id: &str) -> Option<&PanelInfo> {
        self.panels.get(id)
    }

    pub fn all(&self) -> Vec<PanelInfo> {
        let mut v: Vec<PanelInfo> = self.panels.values().cloned().collect();
        v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        v
    }

    /// Resolve a caller-supplied panel reference: an exact id first, then a
    /// case-insensitive name. Names are not unique in the app and there is no
    /// name index anywhere, so ambiguity has to be reported rather than
    /// guessed at.
    pub fn resolve(&self, reference: &str) -> Resolution {
        let needle = reference.trim();
        if needle.is_empty() {
            return Resolution::NotFound;
        }
        if let Some(p) = self.panels.get(needle) {
            return Resolution::One(p.clone());
        }
        let lower = needle.to_lowercase();
        let matches: Vec<PanelInfo> = self
            .panels
            .values()
            .filter(|p| p.name.trim().to_lowercase() == lower)
            .cloned()
            .collect();
        match matches.len() {
            0 => Resolution::NotFound,
            1 => Resolution::One(matches.into_iter().next().unwrap()),
            _ => Resolution::Ambiguous(matches),
        }
    }
}

pub enum Resolution {
    One(PanelInfo),
    Ambiguous(Vec<PanelInfo>),
    NotFound,
}
