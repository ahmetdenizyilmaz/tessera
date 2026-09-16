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
    ReadRequest {
        request_id: String,
        target_panel_id: String,
        limit: usize,
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
