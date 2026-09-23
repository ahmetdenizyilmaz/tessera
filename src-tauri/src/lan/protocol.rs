use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u16 = 2;
pub const DEFAULT_PORT: u16 = 43_721;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub device_id: String,
    pub name: String,
    pub protocol_version: u16,
    pub listen_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePanelInfo {
    pub id: String,
    pub name: String,
    pub cwd: String,
    pub kind: String,
    pub provider: String,
    pub status: String,
    pub busy: bool,
    pub awaiting_user: bool,
    pub model: Option<String>,
    pub reachable: bool,
    /// Optional extension. Never send raw-input requests to older hosts.
    #[serde(default)]
    pub terminal_input: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WireMessage {
    Hello {
        node: NodeInfo,
    },
    /// Sent by the receiving computer after its user answers a connection
    /// request. Only appears on first contact.
    PairDecision {
        accepted: bool,
        reason: Option<String>,
    },
    Registry {
        panels: Vec<RemotePanelInfo>,
    },
    SendRequest {
        request_id: String,
        target_panel_id: String,
        sender_panel_id: String,
        sender_panel_name: String,
        sender_device_name: String,
        message: String,
        hop: u32,
    },
    SendResult {
        request_id: String,
        result: Option<Value>,
        error: Option<String>,
    },
    /// Human keyboard input, not an agent message. Scoped to one PTY lifetime.
    TerminalInputRequest {
        request_id: String,
        target_panel_id: String,
        input_session: String,
        data: String,
    },
    ReadRequest {
        request_id: String,
        target_panel_id: String,
        limit: usize,
        /// Optional extension: older peers return a transcript, which the
        /// viewer detects and reports as requiring a host update.
        #[serde(default)]
        terminal: bool,
    },
    ReadResult {
        request_id: String,
        result: Option<Value>,
        error: Option<String>,
    },
    Ping {
        nonce: u64,
    },
    Pong {
        nonce: u64,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_registry_does_not_enable_terminal_input() {
        let mut panel = serde_json::json!({"id":"p", "name":"Terminal", "cwd":"", "kind":"terminal",
            "provider":"claude", "status":"running", "busy":false, "awaitingUser":false, "model":null, "reachable":true});
        assert!(!serde_json::from_value::<RemotePanelInfo>(panel.clone()).unwrap().terminal_input);
        panel["terminalInput"] = Value::Bool(true);
        assert!(serde_json::from_value::<RemotePanelInfo>(panel).unwrap().terminal_input);
    }

    #[test]
    fn legacy_reads_remain_transcripts_and_terminal_reads_are_explicit() {
        let old = serde_json::json!({"type":"readRequest", "request_id":"r", "target_panel_id":"p", "limit":100});
        assert!(matches!(
            serde_json::from_value::<WireMessage>(old.clone()).unwrap(),
            WireMessage::ReadRequest {
                terminal: false,
                ..
            }
        ));
        let mut new = old;
        new["terminal"] = Value::Bool(true);
        assert!(matches!(
            serde_json::from_value::<WireMessage>(new).unwrap(),
            WireMessage::ReadRequest { terminal: true, .. }
        ));
    }
}
