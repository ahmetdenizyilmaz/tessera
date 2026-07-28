use serde::{Deserialize, Serialize};

/// Messages sent from desktop to relay backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RelayMessage {
    Auth {
        access_token: String,
        device_id: String,
    },
    Instances {
        instances: Vec<RelayInstanceInfo>,
    },
    PtyOutput {
        instance_id: String,
        data: String,
    },
    PtyExit {
        instance_id: String,
    },
    Command {
        instance_id: String,
        command: String,
    },
    Heartbeat {
        uptime: u64,
        instance_count: usize,
    },
}

/// Auth result received from the relay backend after sending Auth message.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResult {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayInstanceInfo {
    pub id: String,
    pub name: String,
    pub color: String,
    pub status: String,
    pub cwd: String,
    pub model: Option<String>,
}
