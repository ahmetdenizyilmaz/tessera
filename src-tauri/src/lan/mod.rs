pub mod protocol;
mod transport;

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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

const MAGIC: &[u8; 8] = b"TESSLAN1";
const MODE_PAIR: u8 = 1;
const MODE_RECONNECT: u8 = 2;
const PAIR_LIFETIME: Duration = Duration::from_secs(300);
const MAX_PAIR_FAILURES: u8 = 5;

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
            sharing: false,
            name: whoami::devicename(),
            port: DEFAULT_PORT,
            peers: Vec::new(),
        }
    }
}

struct PairingWindow {
    psk: [u8; 32],
    expires: Instant,
    failures: u8,
}

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub sharing: bool,
    pub device_id: String,
    pub name: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub peers: Vec<LanPeerState>,
}

pub struct LanManager {
    private_key: Vec<u8>,
    public_key: Vec<u8>,
    device_id: String,
    config: Arc<Mutex<PersistedConfig>>,
    pairing: Arc<Mutex<Option<PairingWindow>>>,
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
            pairing: Arc::new(Mutex::new(None)),
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
            })
            .collect::<Vec<_>>();
        peers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        LanStatus {
            sharing: cfg.sharing,
            device_id: self.device_id.clone(),
            name: cfg.name,
            port: cfg.port,
            addresses: private_interfaces()
                .into_iter()
                .map(|(ip, _)| format!("{ip}:{}", cfg.port))
                .collect(),
            peers,
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
            MODE_PAIR => {
                let psk = {
                    let mut pairing = self.pairing.lock().unwrap();
                    let window = pairing.as_mut().ok_or("No pairing code is active")?;
                    if window.expires <= Instant::now() || window.failures >= MAX_PAIR_FAILURES {
                        *pairing = None;
                        return Err("Pairing code expired".into());
                    }
                    window.failures += 1;
                    window.psk
                };
                transport::pairing_state(false, &self.private_key, &psk)?
            }
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
                pairing: mode == MODE_PAIR,
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

    async fn pair_outgoing(
        &self,
        address: String,
        code: String,
        app: AppHandle,
    ) -> Result<(), String> {
        let socket = validate_address(&address)?;
        let mut stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(socket))
            .await
            .map_err(|_| "Pairing connection timed out".to_string())?
            .map_err(|e| format!("Connect for pairing: {e}"))?;
        stream.write_all(MAGIC).await.map_err(|e| e.to_string())?;
        stream
            .write_u8(MODE_PAIR)
            .await
            .map_err(|e| e.to_string())?;
        let psk = pairing_psk(&code)?;
        let state = transport::pairing_state(true, &self.private_key, &psk)?;
        let (noise, remote_key) = transport::run_handshake(&mut stream, state, true).await?;
        self.finish_connection(
            stream,
            noise,
            ConnectionContext {
                remote_key,
                pairing: true,
                address: Some(address),
                initiator: true,
            },
            app,
        )
        .await
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
            self.upsert_peer(PeerRecord {
                device_id: derived_id.clone(),
                name: peer_node.name.clone(),
                public_key: BASE64.encode(&remote_key),
                address: peer_addr,
                paired_at: now_secs(),
                auto_connect: true,
            })?;
            *self.pairing.lock().unwrap() = None;
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
                sender_panel_id: _,
                sender_panel_name,
                sender_device_name,
                message,
                hop,
            } => {
                let wrapped = format!("[panel-message from \"{sender_panel_name}\" on \"{sender_device_name}\" · hop {hop}]\n{message}");
                app.state::<crate::panelbus::PanelBus>()
                    .record_inbound_hop(&target_panel_id, hop);
                let result =
                    crate::panelbus::tools::deliver_inbound(app, &target_panel_id, &wrapped).await;
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
            WireMessage::ReadRequest {
                request_id,
                target_panel_id,
                limit,
            } => {
                let result = crate::panelbus::tools::read_local(app, &target_panel_id, limit)
                    .await
                    .and_then(bound_transcript);
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
            WireMessage::Pong { .. } => {}
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
            .send(WireMessage::ReadRequest {
                request_id: request_id.clone(),
                target_panel_id: target_panel_id.into(),
                limit: limit.clamp(1, 100),
            })
            .is_err()
        {
            self.pending.lock().unwrap().remove(&request_id);
            return Err("Remote computer disconnected".into());
        }
        match tokio::time::timeout(Duration::from_secs(15), wait_rx).await {
            Ok(Ok(result)) => result,
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
            pairing: self.pairing.clone(),
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

fn pairing_psk(code: &str) -> Result<[u8; 32], String> {
    let normalized: String = code
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_ascii_lowercase();
    if normalized.len() != 32 {
        return Err("Pairing code must contain 32 hexadecimal characters".into());
    }
    Ok(Sha256::digest(normalized.as_bytes()).into())
}

fn display_pairing_code(raw: &str) -> String {
    raw.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("-")
        .to_ascii_uppercase()
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
    let parsed: SocketAddr = address.trim().parse().map_err(|_| {
        "Enter an IPv4 LAN address including its port, for example 192.168.1.20:43721"
    })?;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingCode {
    code: String,
    expires_in_seconds: u64,
}

#[tauri::command]
pub async fn lan_generate_pairing_code(
    state: tauri::State<'_, LanManager>,
) -> Result<PairingCode, String> {
    if !state.config.lock().unwrap().sharing {
        return Err("Enable Share on local network first".into());
    }
    let raw = uuid::Uuid::new_v4().simple().to_string();
    let display_code = display_pairing_code(&raw);
    *state.pairing.lock().unwrap() = Some(PairingWindow {
        psk: pairing_psk(&raw)?,
        expires: Instant::now() + PAIR_LIFETIME,
        failures: 0,
    });
    Ok(PairingCode {
        code: display_code,
        expires_in_seconds: PAIR_LIFETIME.as_secs(),
    })
}

#[tauri::command]
pub async fn lan_pair(
    address: String,
    code: String,
    app: AppHandle,
    state: tauri::State<'_, LanManager>,
) -> Result<LanStatus, String> {
    if !state.config.lock().unwrap().sharing {
        return Err("Enable Share on local network first".into());
    }
    state.pair_outgoing(address, code, app.clone()).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_codes_are_normalized_and_high_entropy() {
        let raw = "00112233445566778899aabbccddeeff";
        assert_eq!(
            pairing_psk(raw).unwrap(),
            pairing_psk("0011-2233-4455-6677-8899-AABB-CCDD-EEFF").unwrap()
        );
        assert!(pairing_psk("1234").is_err());
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
