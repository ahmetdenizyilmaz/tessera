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

pub const UI_SENDER_ID: &str = "tessera-ui";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelInfo {
    pub id: String,
    pub name: String,
    pub cwd: String,
    /// "chat" | "terminal" | "llm"
    pub kind: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub codex_config: Option<crate::codex::Config>,
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
    /// Present only for a panel mirrored from a paired LAN computer.
    #[serde(default)]
    pub remote_device_id: Option<String>,
    #[serde(default)]
    pub remote_panel_id: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default = "default_connected")]
    pub connected: bool,
}

fn default_connected() -> bool {
    true
}

impl PanelInfo {
    /// Whether `send_to_panel` can deliver here at all. LLM panels run against
    /// a provider API, not a Claude Code process, so there is nothing to write
    /// a user turn into.
    pub fn reachable(&self) -> bool {
        self.connected && (self.kind == "chat" || self.kind == "terminal")
    }

    pub fn qualified_name(&self) -> String {
        self.device_name
            .as_ref()
            .map(|d| format!("{d} / {}", self.name))
            .unwrap_or_else(|| self.name.clone())
    }

    pub fn ui_sender() -> Self {
        Self {
            id: UI_SENDER_ID.into(),
            name: "Tessera user".into(),
            cwd: String::new(),
            kind: "chat".into(),
            provider: None,
            codex_config: None,
            status: "running".into(),
            busy: false,
            awaiting_user: false,
            model: None,
            session_id: None,
            remote_device_id: None,
            remote_panel_id: None,
            device_name: None,
            connected: true,
        }
    }
}

#[derive(Default)]
pub struct PanelRegistry {
    panels: HashMap<String, PanelInfo>,
}

impl PanelRegistry {
    pub fn replace_local(&mut self, panels: Vec<PanelInfo>) {
        self.panels
            .retain(|_, panel| panel.remote_device_id.is_some());
        self.panels
            .extend(panels.into_iter().map(|p| (p.id.clone(), p)));
    }

    pub fn set_remote_peer(
        &mut self,
        device_id: &str,
        device_name: &str,
        panels: &[crate::lan::protocol::RemotePanelInfo],
        connected: bool,
    ) {
        if panels.is_empty() && !connected {
            for panel in self
                .panels
                .values_mut()
                .filter(|p| p.remote_device_id.as_deref() == Some(device_id))
            {
                panel.connected = false;
                panel.status = "offline".into();
            }
            return;
        }
        self.panels
            .retain(|_, panel| panel.remote_device_id.as_deref() != Some(device_id));
        for panel in panels {
            let id = format!("lan:{device_id}:{}", panel.id);
            self.panels.insert(
                id.clone(),
                PanelInfo {
                    id,
                    name: panel.name.clone(),
                    cwd: panel.cwd.clone(),
                    kind: panel.kind.clone(),
                    provider: Some(panel.provider.clone()),
                    codex_config: None,
                    status: if connected {
                        panel.status.clone()
                    } else {
                        "offline".into()
                    },
                    busy: panel.busy,
                    awaiting_user: panel.awaiting_user,
                    model: panel.model.clone(),
                    session_id: None,
                    remote_device_id: Some(device_id.into()),
                    remote_panel_id: Some(panel.id.clone()),
                    device_name: Some(device_name.into()),
                    connected,
                },
            );
        }
    }

    pub fn remove_remote_peer(&mut self, device_id: &str) {
        self.panels
            .retain(|_, panel| panel.remote_device_id.as_deref() != Some(device_id));
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
            return Resolution::One(Box::new(p.clone()));
        }
        let lower = needle.to_lowercase();
        let matches: Vec<PanelInfo> = self
            .panels
            .values()
            .filter(|p| {
                p.name.trim().to_lowercase() == lower || p.qualified_name().to_lowercase() == lower
            })
            .cloned()
            .collect();
        match matches.len() {
            0 => Resolution::NotFound,
            1 => Resolution::One(Box::new(matches.into_iter().next().unwrap())),
            _ => Resolution::Ambiguous(matches),
        }
    }
}

pub enum Resolution {
    One(Box<PanelInfo>),
    Ambiguous(Vec<PanelInfo>),
    NotFound,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote_panel(id: &str, name: &str) -> crate::lan::protocol::RemotePanelInfo {
        crate::lan::protocol::RemotePanelInfo {
            id: id.into(),
            name: name.into(),
            cwd: "C:/work".into(),
            kind: "chat".into(),
            provider: "claude".into(),
            status: "running".into(),
            busy: false,
            awaiting_user: false,
            model: None,
            reachable: true,
            terminal_input: false,
        }
    }

    #[test]
    fn remote_panels_are_device_qualified_and_stay_visible_offline() {
        let mut registry = PanelRegistry::default();
        registry.set_remote_peer(
            "peer-a",
            "Workshop",
            &[remote_panel("panel-1", "Backend")],
            true,
        );
        let panel = registry.get("lan:peer-a:panel-1").unwrap();
        assert_eq!(panel.qualified_name(), "Workshop / Backend");
        assert!(panel.reachable());
        registry.set_remote_peer("peer-a", "Workshop", &[], false);
        let panel = registry.get("lan:peer-a:panel-1").unwrap();
        assert_eq!(panel.status, "offline");
        assert!(!panel.reachable());
        assert!(matches!(
            registry.resolve("Workshop / Backend"),
            Resolution::One(_)
        ));
    }

    #[test]
    fn replacing_local_panels_does_not_delete_remote_roster() {
        let mut registry = PanelRegistry::default();
        registry.set_remote_peer(
            "peer-a",
            "Workshop",
            &[remote_panel("panel-1", "Backend")],
            true,
        );
        registry.replace_local(Vec::new());
        assert!(registry.get("lan:peer-a:panel-1").is_some());
        registry.remove_remote_peer("peer-a");
        assert!(registry.all().is_empty());
    }
}
