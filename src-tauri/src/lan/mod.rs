pub mod protocol;
pub mod terminal;
mod transport;

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};

use protocol::{
    NodeInfo, RemotePanelInfo, WireMessage, DEFAULT_PORT, MAX_MESSAGE_BYTES, PROTOCOL_VERSION,
};

const MAGIC: &[u8; 8] = b"TESSLAN2";
/// First contact: the receiving computer's user must approve the request.
const MODE_INTRODUCE: u8 = 1;
/// Later contact between computers that already pinned each other's key.
const MODE_RECONNECT: u8 = 2;
/// How long the receiving computer keeps an unanswered request open.
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PeerRecord {
    device_id: String,
    name: String,
    public_key: String,
    address: String,
    paired_at: u64,
    #[serde(default = "default_true")]
    auto_connect: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedConfig {
    sharing: bool,
    name: String,
    port: u16,
    peers: Vec<PeerRecord>,
}

impl Default for PersistedConfig {
    fn default() -> Self {
        Self {
            // Listening is what lets another computer send a connection
            // request; the request itself still needs a click on this side.
            sharing: true,
            name: whoami::devicename(),
            port: DEFAULT_PORT,
            peers: Vec::new(),
        }
    }
}

/// A connection request from a computer this one has not paired with yet,
/// waiting for the user to approve or decline it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequestInfo {
    pub request_id: String,
    pub device_id: String,
    pub name: String,
    pub address: String,
    pub fingerprint: String,
    pub received_at: u64,
}

type PendingApprovals = HashMap<String, (PairRequestInfo, oneshot::Sender<bool>)>;

#[derive(Clone)]
struct Connection {
    id: String,
    tx: mpsc::UnboundedSender<WireMessage>,
    cancel: tokio::sync::watch::Sender<bool>,
    last_seen: Arc<AtomicU64>,
}

type PendingRequests = HashMap<String, oneshot::Sender<Result<Value, String>>>;

struct ConnectionContext {
    remote_key: Vec<u8>,
    pairing: bool,
    address: Option<String>,
    initiator: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPeerState {
    pub device_id: String,
    pub name: String,
    pub address: String,
    pub connected: bool,
    pub panels: Vec<RemotePanelInfo>,
    pub registry_ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub sharing: bool,
    pub device_id: String,
    pub name: String,
    pub fingerprint: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub peers: Vec<LanPeerState>,
    pub pending_requests: Vec<PairRequestInfo>,
}

pub struct LanManager {
    private_key: Vec<u8>,
    public_key: Vec<u8>,
    device_id: String,
    config: Arc<Mutex<PersistedConfig>>,
    approvals: Arc<Mutex<PendingApprovals>>,
    connections: Arc<Mutex<HashMap<String, Connection>>>,
    remote_panels: Arc<Mutex<HashMap<String, Vec<RemotePanelInfo>>>>,
    pending: Arc<Mutex<PendingRequests>>,
    listener_stop: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    listener_running: Arc<AtomicBool>,
    reconnect_supervisor_running: Arc<AtomicBool>,
}

impl LanManager {
    pub fn new() -> Result<Self, String> {
        let (private_key, public_key) = load_or_create_identity()?;
        let digest = Sha256::digest(&public_key);
        let device_id = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
        Ok(Self {
            private_key,
            public_key,
            device_id,
            config: Arc::new(Mutex::new(load_config())),
            approvals: Arc::new(Mutex::new(HashMap::new())),
            connections: Arc::new(Mutex::new(HashMap::new())),
            remote_panels: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            listener_stop: Arc::new(Mutex::new(None)),
            listener_running: Arc::new(AtomicBool::new(false)),
            reconnect_supervisor_running: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn initialize(&self, app: AppHandle) {
        if self.config.lock().unwrap().sharing {
            self.start_listener(app.clone());
            self.connect_all(app);
        }
    }

    fn node_info(&self) -> NodeInfo {
        let cfg = self.config.lock().unwrap();
        NodeInfo {
            device_id: self.device_id.clone(),
            name: cfg.name.clone(),
            protocol_version: PROTOCOL_VERSION,
            listen_port: cfg.port,
        }
    }

    fn status(&self) -> LanStatus {
        let cfg = self.config.lock().unwrap().clone();
        let connections = self.connections.lock().unwrap();
        let remote = self.remote_panels.lock().unwrap();
        let mut peers = cfg
            .peers
            .iter()
            .map(|p| LanPeerState {
                device_id: p.device_id.clone(),
                name: p.name.clone(),
                address: p.address.clone(),
                connected: connections.contains_key(&p.device_id),
                panels: remote.get(&p.device_id).cloned().unwrap_or_default(),
                registry_ready: remote.contains_key(&p.device_id),
            })
            .collect::<Vec<_>>();
        peers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let mut pending_requests = self
            .approvals
            .lock()
            .unwrap()
            .values()
            .map(|(info, _)| info.clone())
            .collect::<Vec<_>>();
        pending_requests.sort_by_key(|r| r.received_at);
        LanStatus {
            sharing: cfg.sharing,
            device_id: self.device_id.clone(),
            name: cfg.name,
            fingerprint: fingerprint(&self.public_key),
            port: cfg.port,
            addresses: private_interfaces()
                .into_iter()
                .map(|(ip, _)| format!("{ip}:{}", cfg.port))
                .collect(),
            peers,
            pending_requests,
        }
    }

    fn emit_state(&self, app: &AppHandle) {
        let _ = app.emit("lan-state", self.status());
    }

    fn start_listener(&self, app: AppHandle) {
        if self.listener_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let port = self.config.lock().unwrap().port;
        let (stop_tx, mut stop_rx) = oneshot::channel();
        *self.listener_stop.lock().unwrap() = Some(stop_tx);
        let manager = app.state::<LanManager>().inner().clone_refs();
        tauri::async_runtime::spawn(async move {
            let listener = match TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await {
                Ok(v) => v,
                Err(e) => {
                    manager.listener_running.store(false, Ordering::SeqCst);
                    let _ = app.emit(
                        "lan-error",
                        format!("Could not listen on LAN port {port}: {e}"),
                    );
                    manager.emit_state(&app);
                    return;
                }
            };
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    accepted = listener.accept() => match accepted {
                        Ok((stream, addr)) if is_same_private_subnet(addr.ip()) => {
                            let child = manager.clone_refs();
                            let child_app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = child.accept_connection(stream, addr, child_app.clone()).await {
                                    let _ = child_app.emit("lan-error", e);
                                }
                            });
                        }
                        Ok((_stream, addr)) => {
                            eprintln!("[lan] rejected non-local peer {addr}");
                        }
                        Err(e) => eprintln!("[lan] accept failed: {e}"),
                    }
                }
            }
            manager.listener_running.store(false, Ordering::SeqCst);
        });
    }

    fn stop_listener(&self) {
        if let Some(stop) = self.listener_stop.lock().unwrap().take() {
            let _ = stop.send(());
        }
        self.listener_running.store(false, Ordering::SeqCst);
        for (_, (_, decision)) in self.approvals.lock().unwrap().drain() {
            let _ = decision.send(false);
        }
        let mut connections = self.connections.lock().unwrap();
        for connection in connections.values() {
            let _ = connection.cancel.send(true);
        }
        connections.clear();
    }

    fn connect_all(&self, app: AppHandle) {
        if self
            .reconnect_supervisor_running
            .swap(true, Ordering::SeqCst)
        {
            return;
        }
        let manager = self.clone_refs();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));
            loop {
                interval.tick().await;
                if !manager.config.lock().unwrap().sharing {
                    manager
                        .reconnect_supervisor_running
                        .store(false, Ordering::SeqCst);
                    return;
                }
                let peers = manager.config.lock().unwrap().peers.clone();
                for peer in peers {
                    // Deterministic reconnect ownership prevents both apps from
                    // repeatedly opening a socket at the same time.
                    if peer.auto_connect
                        && manager.device_id < peer.device_id
                        && !manager
                            .connections
                            .lock()
                            .unwrap()
                            .contains_key(&peer.device_id)
                    {
                        let _ = manager.connect_known(&peer.device_id, app.clone()).await;
                    }
                }
                let connections = manager
                    .connections
                    .lock()
                    .unwrap()
                    .values()
                    .cloned()
                    .collect::<Vec<_>>();
                let now = now_secs();
                for connection in connections {
                    if now.saturating_sub(connection.last_seen.load(Ordering::Relaxed)) > 15 {
                        let _ = connection.cancel.send(true);
                    } else {
                        let _ = connection.tx.send(WireMessage::Ping { nonce: now });
                    }
                }
            }
        });
    }

    async fn accept_connection(
        &self,
        mut stream: TcpStream,
        addr: SocketAddr,
        app: AppHandle,
    ) -> Result<(), String> {
        let mut magic = [0u8; 8];
        stream
            .read_exact(&mut magic)
            .await
            .map_err(|e| format!("LAN header: {e}"))?;
        if &magic != MAGIC {
            return Err("Rejected an invalid LAN connection".into());
        }
        let mode = stream
            .read_u8()
            .await
            .map_err(|e| format!("LAN mode: {e}"))?;
        let state = match mode {
            MODE_INTRODUCE => transport::introduce_state(false, &self.private_key)?,
            MODE_RECONNECT => transport::reconnect_state(false, &self.private_key, None)?,
            _ => return Err("Unsupported LAN connection mode".into()),
        };
        let (noise, remote_key) = tokio::time::timeout(
            Duration::from_secs(10),
            transport::run_handshake(&mut stream, state, false),
        )
        .await
        .map_err(|_| "LAN handshake timed out".to_string())??;
        let address = format!("{}:{}", addr.ip(), DEFAULT_PORT);
        self.finish_connection(
            stream,
            noise,
            ConnectionContext {
                remote_key,
                pairing: mode == MODE_INTRODUCE,
                address: Some(address),
                initiator: false,
            },
            app,
        )
        .await
    }

    async fn connect_known(&self, peer_id: &str, app: AppHandle) -> Result<(), String> {
        let peer = self
            .config
            .lock()
            .unwrap()
            .peers
            .iter()
            .find(|p| p.device_id == peer_id)
            .cloned()
            .ok_or("Paired computer not found")?;
        let address = validate_address(&peer.address)?;
        let mut stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(address))
            .await
            .map_err(|_| "LAN connection timed out".to_string())?
            .map_err(|e| format!("Connect to {}: {e}", peer.name))?;
        stream.write_all(MAGIC).await.map_err(|e| e.to_string())?;
        stream
            .write_u8(MODE_RECONNECT)
            .await
            .map_err(|e| e.to_string())?;
        let remote_key = BASE64
            .decode(&peer.public_key)
            .map_err(|_| "Stored peer key is invalid")?;
        let state = transport::reconnect_state(true, &self.private_key, Some(&remote_key))?;
        let (noise, actual_key) = transport::run_handshake(&mut stream, state, true).await?;
        self.finish_connection(
            stream,
            noise,
            ConnectionContext {
                remote_key: actual_key,
                pairing: false,
                address: Some(peer.address),
                initiator: true,
            },
            app,
        )
        .await
    }

    /// Open a first-contact connection to `address` and wait for the person
    /// on that computer to approve it.
    async fn request_outgoing(&self, address: String, app: AppHandle) -> Result<(), String> {
        let socket = validate_address(&address)?;
        let hint = "Is Tessera running there with Share on local network enabled?";
        let mut stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(socket))
            .await
            .map_err(|_| format!("{} did not answer. {hint}", socket.ip()))?
            .map_err(|e| format!("Could not reach {}: {e}. {hint}", socket.ip()))?;
        stream.write_all(MAGIC).await.map_err(|e| e.to_string())?;
        stream
            .write_u8(MODE_INTRODUCE)
            .await
            .map_err(|e| e.to_string())?;
        let state = transport::introduce_state(true, &self.private_key)?;
        let (noise, remote_key) = tokio::time::timeout(
            Duration::from_secs(10),
            transport::run_handshake(&mut stream, state, true),
        )
        .await
        .map_err(|_| "The other computer did not complete the encrypted handshake".to_string())??;
        self.finish_connection(
            stream,
            noise,
            ConnectionContext {
                remote_key,
                pairing: true,
                address: Some(socket.to_string()),
                initiator: true,
            },
            app,
        )
        .await
    }

    /// Show the request to the user and wait for their answer. Resolves to
    /// `Ok(false)` on decline; errors when the request times out or the
    /// requesting computer goes away first.
    async fn await_approval<R>(
        &self,
        info: PairRequestInfo,
        reader: &mut R,
        noise: &Arc<tokio::sync::Mutex<snow::TransportState>>,
        app: &AppHandle,
    ) -> Result<bool, String>
    where
        R: tokio::io::AsyncRead + Unpin,
    {
        let (decide, decision) = oneshot::channel();
        self.approvals
            .lock()
            .unwrap()
            .insert(info.request_id.clone(), (info.clone(), decide));
        self.emit_state(app);
        let _ = app.emit("lan-pair-request", &info);
        // The prompt is modal; make sure a minimized or backgrounded window
        // is noticed without stealing focus from whatever the user is doing.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
        let result = tokio::select! {
            answer = tokio::time::timeout(APPROVAL_TIMEOUT, decision) => match answer {
                Ok(Ok(accepted)) => Ok(accepted),
                Ok(Err(_)) => Ok(false),
                Err(_) => Err(format!("The connection request from {} expired", info.name)),
            },
            // The requester sends nothing while it waits, so any read result
            // here means it hung up or misbehaved.
            _ = read_wire(reader, noise) => Err(format!("{} cancelled its connection request", info.name)),
        };
        self.approvals.lock().unwrap().remove(&info.request_id);
        self.emit_state(app);
        result
    }

    async fn finish_connection(
        &self,
        stream: TcpStream,
        noise: snow::TransportState,
        context: ConnectionContext,
        app: AppHandle,
    ) -> Result<(), String> {
        let ConnectionContext {
            remote_key,
            pairing,
            address,
            initiator,
        } = context;
        let noise = Arc::new(tokio::sync::Mutex::new(noise));
        let (mut reader, mut writer) = stream.into_split();
        let hello = WireMessage::Hello {
            node: self.node_info(),
        };
        write_wire(&mut writer, &noise, &hello).await?;
        let peer_node = match read_wire(&mut reader, &noise).await? {
            WireMessage::Hello { node } => node,
            _ => return Err("Peer did not identify itself".into()),
        };
        if peer_node.protocol_version != PROTOCOL_VERSION {
            return Err(format!(
                "Incompatible Tessera LAN protocol {}",
                peer_node.protocol_version
            ));
        }
        let digest = Sha256::digest(&remote_key);
        let derived_id: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
        if derived_id != peer_node.device_id || derived_id == self.device_id {
            return Err("Peer identity does not match its encrypted key".into());
        }

        if pairing {
            let peer_addr =
                address.unwrap_or_else(|| format!("127.0.0.1:{}", peer_node.listen_port));
            let ip = peer_addr.split(':').next().unwrap_or("");
            let peer_addr = format!("{ip}:{}", peer_node.listen_port);
            let encoded_key = BASE64.encode(&remote_key);
            if initiator {
                // Give the person on the other computer time to click Approve.
                let decision = tokio::time::timeout(
                    APPROVAL_TIMEOUT + Duration::from_secs(10),
                    read_wire(&mut reader, &noise),
                )
                .await
                .map_err(|_| {
                    format!("{} did not answer the connection request", peer_node.name)
                })??;
                match decision {
                    WireMessage::PairDecision { accepted: true, .. } => {}
                    WireMessage::PairDecision {
                        accepted: false,
                        reason,
                    } => {
                        return Err(reason.unwrap_or_else(|| {
                            format!("{} declined the connection", peer_node.name)
                        }));
                    }
                    _ => return Err("The other computer skipped the approval step".into()),
                }
            } else {
                let already_paired = self
                    .config
                    .lock()
                    .unwrap()
                    .peers
                    .iter()
                    .any(|p| p.device_id == derived_id && p.public_key == encoded_key);
                if !already_paired {
                    let info = PairRequestInfo {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        device_id: derived_id.clone(),
                        name: peer_node.name.clone(),
                        address: ip.to_string(),
                        fingerprint: fingerprint(&remote_key),
                        received_at: now_secs(),
                    };
                    if !self.await_approval(info, &mut reader, &noise, &app).await? {
                        let reason = format!(
                            "{} declined the connection",
                            self.config.lock().unwrap().name
                        );
                        let _ = write_wire(
                            &mut writer,
                            &noise,
                            &WireMessage::PairDecision {
                                accepted: false,
                                reason: Some(reason),
                            },
                        )
                        .await;
                        return Ok(());
                    }
                }
                write_wire(
                    &mut writer,
                    &noise,
                    &WireMessage::PairDecision {
                        accepted: true,
                        reason: None,
                    },
                )
                .await?;
            }
            self.upsert_peer(PeerRecord {
                device_id: derived_id.clone(),
                name: peer_node.name.clone(),
                public_key: encoded_key,
                address: peer_addr,
                paired_at: now_secs(),
                auto_connect: true,
            })?;
        } else {
            let known = self.config.lock().unwrap().peers.iter().any(|p| {
                p.device_id == derived_id
                    && p.public_key == BASE64.encode(&remote_key)
                    && p.auto_connect
            });
            if !known {
                return Err("This computer is not paired".into());
            }
        }

        let (tx, mut rx) = mpsc::unbounded_channel();
        let (cancel, mut writer_cancel) = tokio::sync::watch::channel(false);
        let last_seen = Arc::new(AtomicU64::new(now_secs()));
        let connection_id = uuid::Uuid::new_v4().to_string();
        {
            let mut conns = self.connections.lock().unwrap();
            if let Some(existing) = conns.get(&derived_id) {
                // The lower device id owns outgoing reconnects. Retain the direction
                // implied by that rule when both sides connect simultaneously.
                let preferred_initiator = self.device_id < derived_id;
                if initiator != preferred_initiator {
                    return Ok(());
                }
                let _ = existing.cancel.send(true);
            }
            conns.insert(
                derived_id.clone(),
                Connection {
                    id: connection_id.clone(),
                    tx: tx.clone(),
                    cancel: cancel.clone(),
                    last_seen: last_seen.clone(),
                },
            );
        }
        // Capabilities must be learned again on every connection; a paired
        // computer may have been downgraded since its last registry arrived.
        self.remote_panels.lock().unwrap().remove(&derived_id);
        self.emit_state(&app);

        let initial = WireMessage::Registry {
            panels: local_panel_snapshot(&app),
        };
        let _ = tx.send(initial);

        let writer_noise = noise.clone();
        let writer_task = tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = writer_cancel.changed() => break,
                    message = rx.recv() => match message {
                        Some(message) if write_wire(&mut writer, &writer_noise, &message).await.is_ok() => {},
                        _ => break,
                    }
                }
            }
        });

        let manager = self.clone_refs();
        let peer_id = derived_id.clone();
        let peer_name = peer_node.name.clone();
        let mut reader_cancel = cancel.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = reader_cancel.changed() => break,
                    message = read_wire(&mut reader, &noise) => match message {
                        Ok(message) => {
                            last_seen.store(now_secs(), Ordering::Relaxed);
                            manager.handle_wire(&peer_id, message, &tx, &app).await;
                        }
                        Err(_) => break,
                    }
                }
            }
            writer_task.abort();
            let removed = {
                let mut conns = manager.connections.lock().unwrap();
                if conns.get(&peer_id).is_some_and(|c| c.id == connection_id) {
                    conns.remove(&peer_id);
                    true
                } else {
                    false
                }
            };
            if removed {
                app.state::<crate::panelbus::PanelBus>().set_remote_peer(
                    &peer_id,
                    &peer_name,
                    &[],
                    false,
                );
                manager.emit_state(&app);
            }
        });
        Ok(())
    }

    async fn handle_wire(
        &self,
        peer_id: &str,
        message: WireMessage,
        tx: &mpsc::UnboundedSender<WireMessage>,
        app: &AppHandle,
    ) {
        match message {
            WireMessage::Registry { panels } => {
                self.remote_panels
                    .lock()
                    .unwrap()
                    .insert(peer_id.to_string(), panels.clone());
                let name = self.peer_name(peer_id);
                app.state::<crate::panelbus::PanelBus>()
                    .set_remote_peer(peer_id, &name, &panels, true);
                self.emit_state(app);
            }
            WireMessage::SendRequest {
                request_id,
                target_panel_id,
                sender_panel_id,
                sender_panel_name,
                sender_device_name,
                message,
                hop,
            } => {
                let (text, inbound_hop) = inbound_message(
                    &sender_panel_id, &sender_panel_name, &sender_device_name, &message, hop,
                );
                app.state::<crate::panelbus::PanelBus>()
                    .record_inbound_hop(&target_panel_id, inbound_hop);
                let result =
                    crate::panelbus::tools::deliver_inbound(app, &target_panel_id, &text).await;
                let reply = match result {
                    Ok(v) => WireMessage::SendResult {
                        request_id,
                        result: Some(v),
                        error: None,
                    },
                    Err(e) => WireMessage::SendResult {
                        request_id,
                        result: None,
                        error: Some(e),
                    },
                };
                let _ = tx.send(reply);
            }
            WireMessage::TerminalInputRequest { request_id, target_panel_id, input_session, data } => {
                // Synchronous delivery preserves wire order. It never spawns,
                // resizes or forwards input to another computer.
                let active = self.connections.lock().unwrap().get(peer_id)
                    .is_some_and(|connection| connection.tx.same_channel(tx) && !*connection.cancel.borrow());
                let result = if active {
                    terminal::write_local(app, &target_panel_id, &input_session, &data)
                } else { Err("This LAN connection is no longer active".into()) };
                let (result, error) = match result {
                    Ok(value) => (Some(value), None),
                    Err(error) => (None, Some(error)),
                };
                let _ = tx.send(WireMessage::SendResult { request_id, result, error });
            }
            WireMessage::ReadRequest {
                request_id,
                target_panel_id,
                limit,
                terminal,
            } => {
                // Do not block this connection's reader while the host UI is
                // producing a snapshot; both PCs may be viewing each other.
                let app = app.clone();
                let tx = tx.clone();
                tauri::async_runtime::spawn(async move {
                    let result = if terminal {
                        terminal::read_local(&app, &target_panel_id).await
                    } else {
                        crate::panelbus::tools::read_local(&app, &target_panel_id, limit)
                            .await
                            .and_then(bound_transcript)
                    };
                    let reply = match result {
                        Ok(v) => WireMessage::ReadResult {
                            request_id,
                            result: Some(v),
                            error: None,
                        },
                        Err(e) => WireMessage::ReadResult {
                            request_id,
                            result: None,
                            error: Some(e),
                        },
                    };
                    let _ = tx.send(reply);
                });
            }
            WireMessage::SendResult {
                request_id,
                result,
                error,
            }
            | WireMessage::ReadResult {
                request_id,
                result,
                error,
            } => {
                if let Some(waiter) = self.pending.lock().unwrap().remove(&request_id) {
                    let _ =
                        waiter.send(error.map_or_else(|| Ok(result.unwrap_or(Value::Null)), Err));
                }
            }
            WireMessage::Ping { nonce } => {
                let _ = tx.send(WireMessage::Pong { nonce });
            }
            WireMessage::Hello { node } => {
                if node.device_id == peer_id {
                    let panels = self
                        .remote_panels
                        .lock()
                        .unwrap()
                        .get(peer_id)
                        .cloned()
                        .unwrap_or_default();
                    {
                        let mut cfg = self.config.lock().unwrap();
                        if let Some(peer) = cfg.peers.iter_mut().find(|p| p.device_id == peer_id) {
                            peer.name = node.name.clone();
                            let _ = save_config(&cfg);
                        }
                    }
                    app.state::<crate::panelbus::PanelBus>()
                        .set_remote_peer(peer_id, &node.name, &panels, true);
                    self.emit_state(app);
                }
            }
            WireMessage::Pong { .. } | WireMessage::PairDecision { .. } => {}
        }
    }

    fn upsert_peer(&self, peer: PeerRecord) -> Result<(), String> {
        let mut cfg = self.config.lock().unwrap();
        cfg.peers.retain(|p| p.device_id != peer.device_id);
        cfg.peers.push(peer);
        save_config(&cfg)
    }

    fn peer_name(&self, id: &str) -> String {
        self.config
            .lock()
            .unwrap()
            .peers
            .iter()
            .find(|p| p.device_id == id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Remote computer".into())
    }

    pub fn broadcast_registry(&self, panels: Vec<RemotePanelInfo>) {
        for conn in self.connections.lock().unwrap().values() {
            let _ = conn.tx.send(WireMessage::Registry {
                panels: panels.clone(),
            });
        }
    }

    fn broadcast_hello(&self) {
        let hello = WireMessage::Hello {
            node: self.node_info(),
        };
        for conn in self.connections.lock().unwrap().values() {
            let _ = conn.tx.send(hello.clone());
        }
    }

    pub async fn send_remote(
        &self,
        device_id: &str,
        target_panel_id: &str,
        sender: &crate::panelbus::registry::PanelInfo,
        message: &str,
        hop: u32,
    ) -> Result<Value, String> {
        if message.len() > MAX_MESSAGE_BYTES {
            return Err("Panel message exceeds 64 KiB".into());
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let tx = self
            .connections
            .lock()
            .unwrap()
            .get(device_id)
            .map(|c| c.tx.clone())
            .ok_or("Remote computer is offline")?;
        let (wait_tx, wait_rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap()
            .insert(request_id.clone(), wait_tx);
        if tx
            .send(WireMessage::SendRequest {
                request_id: request_id.clone(),
                target_panel_id: target_panel_id.into(),
                sender_panel_id: sender.id.clone(),
                sender_panel_name: sender.name.clone(),
                sender_device_name: self.config.lock().unwrap().name.clone(),
                message: message.into(),
                hop,
            })
            .is_err()
        {
            self.pending.lock().unwrap().remove(&request_id);
            return Err("Remote computer disconnected".into());
        }
        match tokio::time::timeout(Duration::from_secs(15), wait_rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Remote delivery channel closed".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&request_id);
                Err("Remote delivery timed out".into())
            }
        }
    }

    pub async fn read_remote(
        &self,
        device_id: &str,
        target_panel_id: &str,
        limit: usize,
    ) -> Result<Value, String> {
        self.read_remote_view(device_id, target_panel_id, limit, false)
            .await
    }

    async fn terminal_input(
        &self, device_id: &str, panel_id: &str, connection_id: &str, input_session: &str, data: &str,
    ) -> Result<Value, String> {
        terminal::validate_input(data)?;
        let connection = self.connections.lock().unwrap().get(device_id).cloned()
            .ok_or("Remote computer is offline")?;
        if connection.id != connection_id {
            return Err("The connection changed. Refresh the terminal before typing again.".into());
        }
        let supported = self.remote_panels.lock().unwrap().get(device_id)
            .is_some_and(|panels| panels.iter().any(|p| p.id == panel_id && p.kind == "terminal" && p.terminal_input));
        if !supported {
            return Err("Update Tessera on the host computer to enable direct terminal input.".into());
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(request_id.clone(), tx);
        let result = async {
            connection.tx.send(WireMessage::TerminalInputRequest {
                request_id: request_id.clone(), target_panel_id: panel_id.into(),
                input_session: input_session.into(), data: data.into(),
            }).map_err(|_| "Remote computer disconnected".to_string())?;
            tokio::time::timeout(Duration::from_secs(5), rx).await
                .map_err(|_| "Terminal input acknowledgement timed out; do not resend automatically".to_string())?
                .map_err(|_| "Remote input channel closed".to_string())?
        }.await;
        self.pending.lock().unwrap().remove(&request_id);
        result
    }

    async fn read_remote_view(
        &self,
        device_id: &str,
        target_panel_id: &str,
        limit: usize,
        terminal: bool,
    ) -> Result<Value, String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let connection = self
            .connections
            .lock()
            .unwrap()
            .get(device_id)
            .cloned()
            .ok_or("Remote computer is offline")?;
        let (wait_tx, wait_rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap()
            .insert(request_id.clone(), wait_tx);
        if connection.tx
            .send(WireMessage::ReadRequest {
                request_id: request_id.clone(),
                target_panel_id: target_panel_id.into(),
                limit: limit.clamp(1, 100),
                terminal,
            })
            .is_err()
        {
            self.pending.lock().unwrap().remove(&request_id);
            return Err("Remote computer disconnected".into());
        }
        match tokio::time::timeout(Duration::from_secs(15), wait_rx).await {
            Ok(Ok(result)) => result.map(|mut value| {
                if terminal && value.is_object() {
                    value["connectionId"] = Value::String(connection.id.clone());
                }
                value
            }),
            Ok(Err(_)) => Err("Remote transcript channel closed".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&request_id);
                Err("Remote transcript request timed out".into())
            }
        }
    }

    fn clone_refs(&self) -> Self {
        Self {
            private_key: self.private_key.clone(),
            public_key: self.public_key.clone(),
            device_id: self.device_id.clone(),
            config: self.config.clone(),
            approvals: self.approvals.clone(),
            connections: self.connections.clone(),
            remote_panels: self.remote_panels.clone(),
            pending: self.pending.clone(),
            listener_stop: self.listener_stop.clone(),
            listener_running: self.listener_running.clone(),
            reconnect_supervisor_running: self.reconnect_supervisor_running.clone(),
        }
    }
}

async fn write_wire<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    noise: &Arc<tokio::sync::Mutex<snow::TransportState>>,
    message: &WireMessage,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(message).map_err(|e| format!("Serialize LAN message: {e}"))?;
    let packets = { transport::encrypt_message(&mut *noise.lock().await, &bytes)? };
    transport::write_encrypted_packets(writer, &packets).await
}

async fn read_wire<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
    noise: &Arc<tokio::sync::Mutex<snow::TransportState>>,
) -> Result<WireMessage, String> {
    let packets = transport::read_encrypted_packets(reader).await?;
    let bytes = { transport::decrypt_message(&mut *noise.lock().await, &packets)? };
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid LAN message: {e}"))
}

fn local_panel_snapshot(app: &AppHandle) -> Vec<RemotePanelInfo> {
    app.state::<crate::panelbus::PanelBus>()
        .local_panels()
        .into_iter()
        .map(|p| RemotePanelInfo {
            terminal_input: p.kind == "terminal",
            reachable: p.reachable(),
            id: p.id,
            name: p.name,
            cwd: p.cwd,
            kind: p.kind,
            provider: p.provider.unwrap_or_else(|| "claude".into()),
            status: p.status,
            busy: p.busy,
            awaiting_user: p.awaiting_user,
            model: p.model,
        })
        .collect()
}

fn inbound_message(sender_id: &str, sender_name: &str, device_name: &str, message: &str, hop: u32) -> (String, u32) {
    if sender_id == crate::panelbus::registry::UI_SENDER_ID {
        // Preserve the human's exact message, including whitespace. Names
        // alone must not turn an agent message into unattributed user input.
        (message.into(), 0)
    } else {
        (format!("[panel-message from \"{sender_name}\" on \"{device_name}\" · hop {hop}]\n{message}"), hop)
    }
}

fn config_path() -> PathBuf {
    crate::app_paths::data_dir().join("lan-peers.json")
}

fn load_config() -> PersistedConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(config: &PersistedConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        path,
        serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn load_or_create_identity() -> Result<(Vec<u8>, Vec<u8>), String> {
    let entry = Entry::new(
        &crate::app_paths::keyring_service("tessera-lan"),
        "noise-identity",
    )
    .map_err(|e| format!("LAN keyring: {e}"))?;
    match entry.get_password() {
        Ok(encoded) => {
            // Snow intentionally keeps key derivation behind its resolver, so
            // persist the generated private/public pair together.
            let mut parts = encoded.splitn(2, '.');
            let private = BASE64
                .decode(parts.next().unwrap_or_default())
                .unwrap_or_default();
            let public = BASE64
                .decode(parts.next().unwrap_or_default())
                .unwrap_or_default();
            if private.len() != 32 || public.len() != 32 {
                return Err("Stored LAN identity has invalid length".into());
            }
            Ok((private, public))
        }
        Err(keyring::Error::NoEntry) => {
            let (private, public) = transport::generate_keypair()?;
            let encoded = format!("{}.{}", BASE64.encode(&private), BASE64.encode(&public));
            entry
                .set_password(&encoded)
                .map_err(|e| format!("Store LAN identity: {e}"))?;
            Ok((private, public))
        }
        Err(e) => Err(format!("Read LAN identity: {e}")),
    }
}

/// Short human-comparable digest of a device's public key, shown in the
/// approval dialog so the two people can confirm they are talking to each other.
fn fingerprint(public_key: &[u8]) -> String {
    let digest = Sha256::digest(public_key);
    digest[..8]
        .chunks(2)
        .map(|pair| format!("{:02X}{:02X}", pair[0], pair[1]))
        .collect::<Vec<_>>()
        .join("-")
}

fn private_interfaces() -> Vec<(Ipv4Addr, Ipv4Addr)> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.addr {
            if_addrs::IfAddr::V4(v4) if v4.ip.is_private() && !v4.ip.is_loopback() => {
                Some((v4.ip, v4.netmask))
            }
            _ => None,
        })
        .collect()
}

fn is_same_private_subnet(peer: IpAddr) -> bool {
    let IpAddr::V4(peer) = peer else {
        return false;
    };
    if !peer.is_private() || peer.is_loopback() {
        return false;
    }
    private_interfaces().iter().any(|(local, mask)| {
        (u32::from(*local) & u32::from(*mask)) == (u32::from(peer) & u32::from(*mask))
    })
}

fn validate_address(address: &str) -> Result<SocketAddr, String> {
    let trimmed = address.trim();
    let parsed: SocketAddr = match trimmed.parse::<Ipv4Addr>() {
        Ok(ip) => SocketAddr::new(IpAddr::V4(ip), DEFAULT_PORT),
        Err(_) => trimmed
            .parse()
            .map_err(|_| "Enter the other computer's IPv4 LAN address, for example 192.168.1.20")?,
    };
    if !is_same_private_subnet(parsed.ip()) {
        return Err(
            "The address is not on this computer's directly connected private subnet".into(),
        );
    }
    Ok(parsed)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn bound_transcript(mut value: Value) -> Result<Value, String> {
    const SAFE_WIRE_BYTES: usize = 900 * 1024;
    while serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > SAFE_WIRE_BYTES {
        let Some(messages) = value.get_mut("messages").and_then(Value::as_array_mut) else {
            return Err("Remote transcript exceeds the encrypted frame limit".into());
        };
        if messages.is_empty() {
            return Err("A remote transcript message exceeds the encrypted frame limit".into());
        }
        messages.remove(0);
    }
    Ok(value)
}

#[tauri::command]
pub async fn lan_status(state: tauri::State<'_, LanManager>) -> Result<LanStatus, String> {
    Ok(state.status())
}

#[tauri::command]
pub async fn lan_set_sharing(
    enabled: bool,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.sharing = enabled;
        save_config(&cfg)?;
    }
    if enabled {
        state.start_listener(app.clone());
        state.connect_all(app.clone());
    } else {
        state.stop_listener();
        for peer in state.config.lock().unwrap().peers.clone() {
            app.state::<crate::panelbus::PanelBus>().set_remote_peer(
                &peer.device_id,
                &peer.name,
                &[],
                false,
            );
        }
    }
    state.emit_state(&app);
    Ok(state.status())
}

#[tauri::command]
pub async fn lan_set_name(
    name: String,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err("Computer name must be 1–64 characters".into());
    }
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.name = name.into();
        save_config(&cfg)?;
    }
    state.broadcast_hello();
    state.emit_state(&app);
    Ok(state.status())
}

/// Ask the computer at `address` to connect. Resolves once its user approves
/// (the peer is then paired and online) or fails with the decline reason.
#[tauri::command]
pub async fn lan_request_pair(
    address: String,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    let socket = validate_address(&address)?;
    let ip = socket.ip().to_string();
    let existing = state
        .config
        .lock()
        .unwrap()
        .peers
        .iter()
        .find(|p| p.address.split(':').next() == Some(ip.as_str()))
        .cloned();
    if let Some(existing) = existing {
        // Already paired with that address: a plain reconnect needs no approval.
        if state
            .connections
            .lock()
            .unwrap()
            .contains_key(&existing.device_id)
        {
            return Ok(state.status());
        }
        if state
            .connect_known(&existing.device_id, app.clone())
            .await
            .is_ok()
        {
            state.emit_state(&app);
            return Ok(state.status());
        }
    }
    // The other computer will reconnect to us later, so this side must listen too.
    let was_listening = {
        let mut cfg = state.config.lock().unwrap();
        let was = cfg.sharing;
        cfg.sharing = true;
        save_config(&cfg)?;
        was
    };
    if !was_listening {
        state.start_listener(app.clone());
        state.connect_all(app.clone());
        state.emit_state(&app);
    }
    state.request_outgoing(address, app.clone()).await?;
    state.emit_state(&app);
    Ok(state.status())
}

/// Answer a connection request shown by `lan-pair-request` / `pendingRequests`.
#[tauri::command]
pub async fn lan_respond_pair_request(
    request_id: String,
    accept: bool,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    let entry = state.approvals.lock().unwrap().remove(&request_id);
    match entry {
        Some((_, decide)) => {
            let _ = decide.send(accept);
        }
        None => return Err("That connection request is no longer waiting".into()),
    }
    state.emit_state(&app);
    Ok(state.status())
}

#[tauri::command]
pub async fn lan_connect(
    device_id: String,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    {
        let mut cfg = state.config.lock().unwrap();
        if let Some(peer) = cfg.peers.iter_mut().find(|p| p.device_id == device_id) {
            peer.auto_connect = true;
        }
        save_config(&cfg)?;
    }
    state.connect_known(&device_id, app.clone()).await?;
    Ok(state.status())
}

#[tauri::command]
pub async fn lan_disconnect(
    device_id: String,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    {
        let mut cfg = state.config.lock().unwrap();
        if let Some(peer) = cfg.peers.iter_mut().find(|p| p.device_id == device_id) {
            peer.auto_connect = false;
        }
        save_config(&cfg)?;
    }
    if let Some(connection) = state.connections.lock().unwrap().remove(&device_id) {
        let _ = connection.cancel.send(true);
    }
    app.state::<crate::panelbus::PanelBus>().set_remote_peer(
        &device_id,
        &state.peer_name(&device_id),
        &[],
        false,
    );
    state.emit_state(&app);
    Ok(state.status())
}

#[tauri::command]
pub async fn lan_forget(
    device_id: String,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    if let Some(connection) = state.connections.lock().unwrap().remove(&device_id) {
        let _ = connection.cancel.send(true);
    }
    state.remote_panels.lock().unwrap().remove(&device_id);
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.peers.retain(|p| p.device_id != device_id);
        save_config(&cfg)?;
    }
    app.state::<crate::panelbus::PanelBus>()
        .remove_remote_peer(&device_id);
    let _ = app.emit("lan-peer-forgotten", &device_id);
    state.emit_state(&app);
    Ok(state.status())
}

#[tauri::command]
pub async fn lan_send_panel(
    device_id: String,
    panel_id: String,
    message: String,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<Value, String> {
    let sender = crate::panelbus::registry::PanelInfo::ui_sender();
    let result = state
        .send_remote(&device_id, &panel_id, &sender, &message, 1)
        .await?;
    let _ = app.emit("lan-state", state.status());
    Ok(result)
}

#[tauri::command]
pub async fn lan_read_panel(
    device_id: String,
    panel_id: String,
    limit: usize,
    state: tauri::State<'_, LanManager>,
) -> Result<Value, String> {
    state.read_remote(&device_id, &panel_id, limit).await
}

#[tauri::command]
pub async fn lan_read_terminal(
    device_id: String,
    panel_id: String,
    state: tauri::State<'_, LanManager>,
) -> Result<Value, String> {
    state.read_remote_view(&device_id, &panel_id, 1, true).await
}

#[tauri::command]
pub async fn lan_terminal_input(
    device_id: String,
    panel_id: String,
    connection_id: String,
    input_session: String,
    data: String,
    state: tauri::State<'_, LanManager>,
) -> Result<Value, String> {
    state.terminal_input(&device_id, &panel_id, &connection_id, &input_session, &data).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_messages_are_verbatim_but_agent_provenance_is_preserved() {
        let text = "  thanks\n  indented\n";
        assert_eq!(inbound_message(crate::panelbus::registry::UI_SENDER_ID, "Tessera user", "PC", text, 1), (text.into(), 0));
        let (message, hop) = inbound_message("agent-id", "Tessera user", "PC", text, 2);
        assert_eq!(message, format!("[panel-message from \"Tessera user\" on \"PC\" · hop 2]\n{text}"));
        assert_eq!(hop, 2);
    }

    #[tokio::test]
    async fn encrypted_peers_exchange_panel_kinds_and_complete_terminal_frames_both_ways() {
        let (a_key, _) = transport::generate_keypair().unwrap();
        let (b_key, _) = transport::generate_keypair().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (a, b) = tokio::join!(
            TcpStream::connect(listener.local_addr().unwrap()),
            listener.accept()
        );
        let mut a = a.unwrap();
        let mut b = b.unwrap().0;
        let (a_noise, b_noise) = tokio::join!(
            transport::run_handshake(
                &mut a,
                transport::introduce_state(true, &a_key).unwrap(),
                true
            ),
            transport::run_handshake(
                &mut b,
                transport::introduce_state(false, &b_key).unwrap(),
                false
            ),
        );
        let a_noise = Arc::new(tokio::sync::Mutex::new(a_noise.unwrap().0));
        let b_noise = Arc::new(tokio::sync::Mutex::new(b_noise.unwrap().0));
        let panels = vec![RemotePanelInfo {
            id: "same-panel-id".into(),
            name: "Claude terminal".into(),
            cwd: "C:/test".into(),
            kind: "terminal".into(),
            provider: "claude".into(),
            status: "running".into(),
            busy: false,
            awaiting_user: false,
            model: None,
            reachable: true,
            terminal_input: true,
        }];
        let registry = WireMessage::Registry { panels };
        write_wire(&mut a, &a_noise, &registry).await.unwrap();
        assert_eq!(
            serde_json::to_value(read_wire(&mut b, &b_noise).await.unwrap()).unwrap(),
            serde_json::to_value(&registry).unwrap()
        );
        let request = WireMessage::ReadRequest {
            request_id: "b-to-a".into(),
            target_panel_id: "same-panel-id".into(),
            limit: 1,
            terminal: true,
        };
        write_wire(&mut b, &b_noise, &request).await.unwrap();
        assert!(matches!(
            read_wire(&mut a, &a_noise).await.unwrap(),
            WireMessage::ReadRequest { terminal: true, .. }
        ));
        let frame = serde_json::json!({"kind":"terminal", "cols":120, "rows":40,
            "data": "\u{1b}[31mwide 漢字\u{1b}[0m\r\n".repeat(8000)});
        let reply = WireMessage::ReadResult {
            request_id: "b-to-a".into(),
            result: Some(frame.clone()),
            error: None,
        };
        // A realistic screen spans multiple encrypted packets; use concurrent
        // read/write so socket buffer capacity cannot mask framing failures.
        let (sent, received) = tokio::join!(
            write_wire(&mut a, &a_noise, &reply),
            read_wire(&mut b, &b_noise)
        );
        sent.unwrap();
        assert!(
            matches!(received.unwrap(), WireMessage::ReadResult { request_id, result: Some(value), error: None }
            if request_id == "b-to-a" && value == frame)
        );
        let reverse = WireMessage::ReadResult {
            request_id: "a-to-b".into(),
            result: Some(frame.clone()),
            error: None,
        };
        let (sent, received) = tokio::join!(
            write_wire(&mut b, &b_noise, &reverse),
            read_wire(&mut a, &a_noise)
        );
        sent.unwrap();
        assert!(
            matches!(received.unwrap(), WireMessage::ReadResult { request_id, result: Some(value), error: None }
            if request_id == "a-to-b" && value == frame)
        );
        let input = WireMessage::TerminalInputRequest {
            request_id: "keys".into(), target_panel_id: "same-panel-id".into(),
            input_session: "one-pty-lifetime".into(), data: "Ünye\x1b[A\t\x03\r".into(),
        };
        write_wire(&mut b, &b_noise, &input).await.unwrap();
        assert_eq!(serde_json::to_value(read_wire(&mut a, &a_noise).await.unwrap()).unwrap(), serde_json::to_value(input).unwrap());
    }

    #[test]
    fn fingerprints_are_short_stable_and_grouped() {
        let key = [42u8; 32];
        let fp = fingerprint(&key);
        assert_eq!(fp, fingerprint(&key));
        assert_eq!(fp.len(), 4 * 4 + 3);
        assert_eq!(fp.split('-').count(), 4);
        assert_ne!(fp, fingerprint(&[43u8; 32]));
    }

    #[test]
    fn bare_addresses_are_parsed_with_the_default_port() {
        // Subnet membership depends on the machine running the tests, so
        // only the parse step and the public-address rejection are checked.
        assert!(validate_address("not an address").is_err());
        let err = validate_address("8.8.8.8").unwrap_err();
        assert!(err.contains("private subnet"), "{err}");
        let err = validate_address("8.8.8.8:43721").unwrap_err();
        assert!(err.contains("private subnet"), "{err}");
    }

    #[test]
    fn public_and_loopback_addresses_are_not_lan_peers() {
        assert!(!is_same_private_subnet("8.8.8.8".parse().unwrap()));
        assert!(!is_same_private_subnet("127.0.0.1".parse().unwrap()));
    }

    #[test]
    fn oversized_transcripts_drop_oldest_messages_to_fit() {
        let value = serde_json::json!({"messages":[
            {"content":"a".repeat(600_000)},
            {"content":"b".repeat(600_000)}
        ]});
        let bounded = bound_transcript(value).unwrap();
        let messages = bounded["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert!(messages[0]["content"].as_str().unwrap().starts_with('b'));
    }
}
