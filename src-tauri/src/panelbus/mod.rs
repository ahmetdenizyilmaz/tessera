//! Panel bus: a loopback MCP server that lets each Claude Code session see and
//! message the other panels open in the app.
//!
//! Design notes that are easy to get wrong later:
//!
//! * The server binds `127.0.0.1:0` **synchronously** during Tauri's `setup()`,
//!   so the port is known before anything can spawn a CLI. It is never rebound —
//!   already-spawned sessions hold the old port in their config file.
//! * Routing, delivery and turn detection all live in Rust. An earlier design
//!   put them behind a `WebviewWindow::eval` bridge; that fails badly because
//!   Chromium throttles timers to 1/s (then 1/min) in an occluded window, so
//!   anything that waits would stall whenever the window is minimised.
//! * The only thing the webview does is push a panel snapshot in
//!   (`panel_registry_sync`) and paint an echo of injected messages out
//!   (`window.__panelInject`, fire-and-forget).

pub mod plugin;
pub mod registry;
pub mod server;
pub mod spawn_config;
pub mod tools;

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use registry::{PanelInfo, PanelRegistry};

/// Server name as the CLI sees it. Tools are therefore `mcp__panels__*`.
pub const SERVER_NAME: &str = "panels";

/// A model that decides to "start fresh" can strip a hop marker out of message
/// text, so depth is tracked here, keyed on the calling panel id taken from the
/// request URL rather than from anything the model controls.
const MAX_HOP: u32 = 3;
const RATE_LIMIT_PER_MIN: usize = 5;

pub struct PanelBus {
    /// `None` when the listener could not bind — the feature degrades to off
    /// and the app still starts.
    pub port: Option<u16>,
    /// Kept only for the CLAUDE_GUI_PANELBUS_DEBUG print; auth uses per-panel
    /// tokens below so a panel can't POST as another by swapping the URL id.
    pub token: String,
    pub enabled: AtomicBool,
    registry: Mutex<PanelRegistry>,
    /// One token per panel id. A panel only ever receives its own (in its own
    /// mcp-config file); the server checks the bearer matches the id in the
    /// path, so a stolen token authenticates only as its rightful panel.
    tokens: Mutex<HashMap<String, String>>,
    /// Hop depth of the most recent injection a panel *received*, with when.
    /// The timestamp lets a stale entry decay so a panel that once received a
    /// deep message isn't bricked from ever initiating a send again.
    inbound_hop: Mutex<HashMap<String, (u32, Instant)>>,
    /// Sliding window of injection timestamps per sending panel.
    sends: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl PanelBus {
    pub fn new(port: Option<u16>, token: String) -> Self {
        Self {
            port,
            token,
            enabled: AtomicBool::new(true),
            registry: Mutex::new(PanelRegistry::default()),
            tokens: Mutex::new(HashMap::new()),
            inbound_hop: Mutex::new(HashMap::new()),
            sends: Mutex::new(HashMap::new()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.port.is_some() && self.enabled.load(Ordering::Relaxed)
    }

    pub fn with_registry<T>(&self, f: impl FnOnce(&PanelRegistry) -> T) -> T {
        let guard = self.registry.lock().unwrap_or_else(|e| e.into_inner());
        f(&guard)
    }

    pub fn replace_panels(&self, panels: Vec<PanelInfo>) {
        let mut guard = self.registry.lock().unwrap_or_else(|e| e.into_inner());
        guard.replace_all(panels);
    }

    /// Hop number a message sent *by* `sender` should carry.
    /// The hop a message *from* `sender` should carry. If the sender received a
    /// message recently, this is a likely relay (received + 1); otherwise it's
    /// a fresh, user-initiated send and starts at 1. Loops bounce in
    /// milliseconds, so a short freshness window still catches them while
    /// never permanently blocking a panel.
    pub fn next_hop(&self, sender: &str) -> u32 {
        const RELAY_WINDOW_SECS: u64 = 120;
        let guard = self.inbound_hop.lock().unwrap_or_else(|e| e.into_inner());
        match guard.get(sender) {
            Some((hop, at)) if at.elapsed().as_secs() < RELAY_WINDOW_SECS => hop + 1,
            _ => 1,
        }
    }

    pub fn record_inbound_hop(&self, target: &str, hop: u32) {
        let mut guard = self.inbound_hop.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(target.to_string(), (hop, Instant::now()));
    }

    /// This panel's bearer token, minting one on first use. Written into the
    /// panel's mcp-config file and checked against the URL path server-side.
    pub fn token_for(&self, panel_id: &str) -> String {
        let mut guard = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .entry(panel_id.to_string())
            .or_insert_with(|| {
                format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4()).replace('-', "")
            })
            .clone()
    }

    /// Does `bearer` authenticate as exactly `panel_id`?
    pub fn token_matches(&self, panel_id: &str, bearer: &str) -> bool {
        let guard = self.tokens.lock().unwrap_or_else(|e| e.into_inner());
        guard.get(panel_id).map(|t| t == bearer).unwrap_or(false)
    }

    /// Drop all per-panel state when a panel closes, so the maps don't grow
    /// for the life of the app.
    pub fn forget_panel(&self, panel_id: &str) {
        self.tokens.lock().unwrap_or_else(|e| e.into_inner()).remove(panel_id);
        self.inbound_hop.lock().unwrap_or_else(|e| e.into_inner()).remove(panel_id);
        self.sends.lock().unwrap_or_else(|e| e.into_inner()).remove(panel_id);
    }

    pub fn hop_exceeded(hop: u32) -> bool {
        hop > MAX_HOP
    }

    pub fn max_hop() -> u32 {
        MAX_HOP
    }

    /// Sliding-window rate limit. Returns `Err` with a human-readable reason
    /// when the sender has been too chatty.
    pub fn check_rate(&self, sender: &str) -> Result<(), String> {
        let mut guard = self.sends.lock().unwrap_or_else(|e| e.into_inner());
        let window = guard.entry(sender.to_string()).or_default();
        let now = Instant::now();
        while let Some(front) = window.front() {
            if now.duration_since(*front).as_secs() >= 60 {
                window.pop_front();
            } else {
                break;
            }
        }
        if window.len() >= RATE_LIMIT_PER_MIN {
            return Err(format!(
                "rate limit reached: a panel may send at most {} messages per minute",
                RATE_LIMIT_PER_MIN
            ));
        }
        window.push_back(now);
        Ok(())
    }
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// Called (debounced) from the app root whenever the instance list or any
/// panel's streaming state changes. Full replacement, not a patch — it is small
/// and a diff would drift.
#[tauri::command]
pub async fn panel_registry_sync(
    panels: Vec<PanelInfo>,
    state: tauri::State<'_, PanelBus>,
) -> Result<(), String> {
    state.replace_panels(panels);
    Ok(())
}

/// Kill switch, for when a loop gets loose.
#[tauri::command]
pub async fn panel_bus_set_enabled(
    enabled: bool,
    state: tauri::State<'_, PanelBus>,
) -> Result<(), String> {
    state.enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct PanelBusStatus {
    pub port: Option<u16>,
    pub enabled: bool,
}

#[tauri::command]
pub async fn panel_bus_status(
    state: tauri::State<'_, PanelBus>,
) -> Result<PanelBusStatus, String> {
    Ok(PanelBusStatus {
        port: state.port,
        enabled: state.is_enabled(),
    })
}
