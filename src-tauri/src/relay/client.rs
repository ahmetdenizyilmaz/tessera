use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tauri::{AppHandle, Emitter};
use futures_util::SinkExt;

use super::protocol::{AuthResult, RelayInstanceInfo, RelayMessage};

type WsSink = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    WsMessage,
>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayInstanceInput {
    pub id: String,
    pub name: String,
    pub color: String,
    pub status: String,
    pub cwd: String,
    pub model: Option<String>,
}

pub struct RelayClient {
    sink: Arc<Mutex<Option<WsSink>>>,
    connected: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    start_time: Instant,
    instance_count: Arc<AtomicUsize>,
}

impl RelayClient {
    pub fn new() -> Self {
        Self {
            sink: Arc::new(Mutex::new(None)),
            connected: Arc::new(AtomicBool::new(false)),
            shutdown: Arc::new(AtomicBool::new(false)),
            start_time: Instant::now(),
            instance_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    pub fn set_instance_count(&self, count: usize) {
        self.instance_count.store(count, Ordering::Relaxed);
    }

    async fn send_msg(&self, msg: &RelayMessage) -> Result<(), String> {
        if !self.connected.load(Ordering::Relaxed) {
            return Ok(()); // Silently skip if not connected (relay is optional)
        }
        let json = serde_json::to_string(msg).map_err(|e| format!("Serialize error: {}", e))?;
        let mut guard = self.sink.lock().await;
        if let Some(sink) = guard.as_mut() {
            sink.send(WsMessage::Text(json.into()))
                .await
                .map_err(|e| format!("Send error: {}", e))?;
        }
        Ok(())
    }

    pub async fn send_pty_output(&self, instance_id: &str, data: &str) {
        let _ = self.send_msg(&RelayMessage::PtyOutput {
            instance_id: instance_id.to_string(),
            data: data.to_string(),
        }).await;
    }

    pub async fn send_pty_exit(&self, instance_id: &str) {
        let _ = self.send_msg(&RelayMessage::PtyExit {
            instance_id: instance_id.to_string(),
        }).await;
    }

    pub async fn send_instances(&self, instances: Vec<RelayInstanceInfo>) -> Result<(), String> {
        self.send_msg(&RelayMessage::Instances { instances }).await
    }

    pub async fn disconnect(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        self.connected.store(false, Ordering::Relaxed);
        let mut guard = self.sink.lock().await;
        if let Some(mut sink) = guard.take() {
            let _ = sink.close().await;
        }
    }
}

#[tauri::command]
pub async fn relay_connect(
    server_url: String,
    access_token: String,
    device_id: String,
    app: AppHandle,
    state: tauri::State<'_, RelayClient>,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio_tungstenite::connect_async;

    state.shutdown.store(false, Ordering::Relaxed);

    // Convert http(s) URL to ws(s)
    let ws_url = server_url
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    let ws_url = format!("{}/ws", ws_url.trim_end_matches('/'));

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut sink, mut stream) = ws_stream.split();

    // Send auth message
    let auth_msg = RelayMessage::Auth {
        access_token,
        device_id,
    };
    let json = serde_json::to_string(&auth_msg).map_err(|e| format!("Serialize error: {}", e))?;
    sink.send(WsMessage::Text(json.into()))
        .await
        .map_err(|e| format!("Failed to send auth: {}", e))?;

    // Wait for auth result with timeout
    let auth_result = tokio::time::timeout(std::time::Duration::from_secs(10), stream.next())
        .await
        .map_err(|_| "Auth timeout".to_string())?
        .ok_or_else(|| "Connection closed during auth".to_string())?
        .map_err(|e| format!("Read error during auth: {}", e))?;

    if let WsMessage::Text(text) = auth_result {
        if let Ok(result) = serde_json::from_str::<AuthResult>(&text) {
            if !result.success {
                return Err(format!("Auth failed: {}", result.error.unwrap_or_default()));
            }
        }
        // If it doesn't parse as AuthResult, assume legacy server and proceed
    }

    // Auth succeeded
    state.connected.store(true, Ordering::Relaxed);
    *state.sink.lock().await = Some(sink);

    // Emit connected event to frontend
    let _ = app.emit("relay-connected", ());

    // Spawn reader task
    let inner_sink = Arc::clone(&state.sink);
    let connected = Arc::clone(&state.connected);
    let shutdown = Arc::clone(&state.shutdown);
    let instance_count = Arc::clone(&state.instance_count);
    let reader_app = app.clone();

    tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            if shutdown.load(Ordering::Relaxed) {
                break;
            }

            match msg {
                Ok(WsMessage::Text(text)) => {
                    if let Ok(relay_msg) = serde_json::from_str::<RelayMessage>(&text) {
                        match relay_msg {
                            RelayMessage::Instances { instances } => {
                                instance_count.store(instances.len(), Ordering::Relaxed);
                            }
                            RelayMessage::Command { instance_id, command } => {
                                let _ = reader_app.emit(
                                    "relay-input",
                                    serde_json::json!({
                                        "instanceId": instance_id,
                                        "data": command,
                                    }),
                                );
                            }
                            _ => {}
                        }
                    }
                }
                Ok(WsMessage::Close(_)) => break,
                Ok(WsMessage::Ping(_)) => {
                    // Pong is handled automatically by tokio-tungstenite
                }
                Err(_) => break,
                _ => {}
            }
        }

        connected.store(false, Ordering::Relaxed);
        {
            let mut guard = inner_sink.lock().await;
            *guard = None;
        }
        let _ = reader_app.emit("relay-disconnected", ());
    });

    // Spawn heartbeat task (sends every 30s)
    let hb_sink = Arc::clone(&state.sink);
    let hb_connected = Arc::clone(&state.connected);
    let hb_shutdown = Arc::clone(&state.shutdown);
    let hb_start_time = state.start_time;
    let hb_instance_count = Arc::clone(&state.instance_count);

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            if hb_shutdown.load(Ordering::Relaxed) || !hb_connected.load(Ordering::Relaxed) {
                break;
            }

            let heartbeat = RelayMessage::Heartbeat {
                uptime: hb_start_time.elapsed().as_secs(),
                instance_count: hb_instance_count.load(Ordering::Relaxed),
            };

            if let Ok(json) = serde_json::to_string(&heartbeat) {
                let mut guard = hb_sink.lock().await;
                if let Some(sink) = guard.as_mut() {
                    if sink.send(WsMessage::Text(json.into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn relay_disconnect(
    app: AppHandle,
    state: tauri::State<'_, RelayClient>,
) -> Result<(), String> {
    state.disconnect().await;
    let _ = app.emit("relay-disconnected", ());
    Ok(())
}

#[tauri::command]
pub async fn relay_status(state: tauri::State<'_, RelayClient>) -> Result<bool, String> {
    Ok(state.is_connected())
}

#[tauri::command]
pub async fn relay_send_instances(
    instances: Vec<RelayInstanceInput>,
    state: tauri::State<'_, RelayClient>,
) -> Result<(), String> {
    let relay_instances: Vec<RelayInstanceInfo> = instances
        .into_iter()
        .map(|i| RelayInstanceInfo {
            id: i.id,
            name: i.name,
            color: i.color,
            status: i.status,
            cwd: i.cwd,
            model: i.model,
        })
        .collect();

    // Update instance count
    state.set_instance_count(relay_instances.len());

    state.send_instances(relay_instances).await
}

#[tauri::command]
pub async fn relay_get_instance_count(
    state: tauri::State<'_, RelayClient>,
) -> Result<usize, String> {
    Ok(state.instance_count.load(Ordering::Relaxed))
}
