use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u16 = 2;
pub const DEFAULT_PORT: u16 = 43_721;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCursor { pub stream_id: String, pub sequence: u64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalViewport {
    pub cols: u16, pub rows: u16, pub input_session: String, pub control_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReadOptions {
    #[serde(default)] pub stream: bool,
    pub cursor: Option<TerminalCursor>,
    pub viewport: Option<TerminalViewport>,
}

impl TerminalReadOptions {
    pub fn validate(&self) -> Result<(), String> {
        if self.cursor.as_ref().is_some_and(|c| c.stream_id.is_empty() || c.stream_id.len() > 128 || c.sequence > 9_007_199_254_740_991) {
            return Err("Invalid terminal stream cursor".into());
        }
        if self.viewport.as_ref().is_some_and(|v| !self.stream || v.cols < 2 || v.rows == 0 || v.cols > 500 || v.rows > 300
            || v.input_session.is_empty() || v.input_session.len() > 128 || v.control_id.is_empty() || v.control_id.len() > 128) {
            return Err("Invalid terminal viewport".into());
        }
        Ok(())
    }
}

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
    /// Incremental VT output and negotiated viewport (optional extension).
    #[serde(default)]
    pub terminal_stream: bool,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        terminal_options: Option<TerminalReadOptions>,
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
        assert!(!serde_json::from_value::<RemotePanelInfo>(panel.clone()).unwrap().terminal_stream);
        panel["terminalInput"] = Value::Bool(true);
        panel["terminalStream"] = Value::Bool(true);
        let current = serde_json::from_value::<RemotePanelInfo>(panel).unwrap();
        assert!(current.terminal_input && current.terminal_stream);
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

    #[test]
    fn streaming_requires_valid_bounded_geometry_and_scoped_ids() {
        let mut options = TerminalReadOptions { stream: true,
            cursor: Some(TerminalCursor { stream_id: "output-stream".into(), sequence: 8 }),
            viewport: Some(TerminalViewport { cols: 140, rows: 45, input_session: "pty-lifetime".into(), control_id: "view-focus".into() }) };
        assert!(options.validate().is_ok());
        options.viewport.as_mut().unwrap().rows = 0;
        assert!(options.validate().is_err());
        options.viewport.as_mut().unwrap().rows = 301;
        assert!(options.validate().is_err());
        options.viewport.as_mut().unwrap().rows = 45;
        options.stream = false;
        assert!(options.validate().is_err());
        options.stream = true;
        options.viewport.as_mut().unwrap().input_session.clear();
        assert!(options.validate().is_err());
        options.viewport = None;
        options.cursor.as_mut().unwrap().sequence = u64::MAX;
        assert!(options.validate().is_err());
    }
}
