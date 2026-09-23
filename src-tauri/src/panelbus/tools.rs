//! The three MCP tools, and their implementations.
//!
//! Everything here runs in Rust. Delivery goes straight into the target's
//! stdin via `stream::manager::send_user_turn`; the webview is only told about
//! it afterwards so the message shows up in the target's transcript, and that
//! notification is fire-and-forget — losing it costs a bubble, not a message.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::registry::Resolution;
use super::{PanelBus, SERVER_NAME};
use crate::pty::manager::PtyManager;
use crate::stream::manager::{StreamJsonManager, TurnOutcome};

const DEFAULT_WAIT_SECS: u64 = 60;
const MAX_WAIT_SECS: u64 = 300;

pub fn definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "list_panels",
            "description": "Find the Claude and Codex sessions open in this Tessera window, including \
        panels inside groups. Panel, session, subwindow, sub-window, pane, tab, chat, conversation, and \
        other agent refer to these same destinations. Call this when the user says 'the other session', \
        'another subwindow', or 'the other one', before sending a message or reading its context. \
        Returns names, qualified names, computer names, ids, providers, working directories, busy/reachable state and is_self. \
        Choose the matching non-self recipient; ask which one if several match. Does not list closed history.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "send_to_panel",
            "description": "Send, tell, ask, message, or forward text to another open Claude or Codex \
        session in Tessera. Use for requests such as 'send the other session this message', 'tell the \
        backend subwindow', 'ask the other tab', or 'message the other agent'. Panel, session, subwindow, \
        sub-window, pane, tab, chat and conversation mean the same destination here. Call list_panels \
        to identify the recipient, then pass its returned name or id in panel. If several recipients \
        match, clarify; do not guess or broadcast. The message arrives as a visible user turn in that \
        session and is submitted automatically. Reply to a panel-message with this tool, not only in \
        your own conversation. Continue the authorized discussion without asking the user to relay replies. \
        Use wait_for_reply=false for back-and-forth exchanges. Busy Codex recipients queue messages for \
        automatic delivery; a queued response means accepted, so do not resend. Stop when the task is \
        resolved, avoiding acknowledgement loops. Set wait_for_reply for an isolated request needing its answer. \
        Sending a message does not approve permissions or bypass a pending prompt.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "panel": { "type": "string", "description": "The destination session/subwindow/pane/tab's exact panel name or id returned by list_panels. Use its id if names are duplicated; do not pass the literal words 'other session'." },
                    "message": { "type": "string", "description": "What to say. Include the context the other panel needs — it cannot see your conversation." },
                    "wait_for_reply": { "type": "boolean", "description": "Block until that panel finishes its turn and return what it said. Default false." },
                    "timeout_seconds": { "type": "number", "description": "Only with wait_for_reply. Default 60, maximum 300." }
                },
                "required": ["panel", "message"],
                "additionalProperties": false
            }
        }),
        json!({
            "name": "read_panel",
            "description": "Read the recent conversation from another open Claude or Codex session \
        (also called a panel, subwindow, sub-window, pane, tab, chat, or other agent) without interrupting it. \
        Use when asked what the other session said or decided. Call list_panels to identify it first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "panel": { "type": "string", "description": "The destination session/subwindow/pane/tab's exact panel name or id from list_panels." },
                    "limit": { "type": "number", "description": "How many recent messages to return. Default 20." }
                },
                "required": ["panel"],
                "additionalProperties": false
            }
        }),
    ]
}

pub async fn call(
    app: &AppHandle,
    caller_id: &str,
    name: &str,
    args: Value,
) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    if !bus.is_enabled() {
        return Err("panel messaging is switched off in this app's settings".into());
    }
    // The caller identifies itself by the URL it was configured with, not by
    // anything the model can influence. A panel that has been closed leaves its
    // tools inert even if its CLI is somehow still alive.
    if bus.with_registry(|r| r.get(caller_id).is_none()) {
        // CLAUDE_GUI_PANELBUS_DEBUG lets the roster be read without a real
        // panel id, so the endpoint can be exercised from curl or the MCP
        // inspector. Read-only, and still behind the bearer token.
        let debug_roster =
            name == "list_panels" && std::env::var("CLAUDE_GUI_PANELBUS_DEBUG").is_ok();
        if !debug_roster {
            return Err(format!(
                "this panel ({}) is no longer open, so its tools are inert",
                caller_id
            ));
        }
    }

    match name {
        "list_panels" => list_panels(app, caller_id),
        "send_to_panel" => send_to_panel(app, caller_id, args).await,
        "read_panel" => read_panel(app, caller_id, args).await,
        other => Err(format!("unknown tool: {}", other)),
    }
}

fn list_panels(app: &AppHandle, caller_id: &str) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    let panels: Vec<Value> = bus.with_registry(|r| {
        r.all()
            .into_iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "name": p.name,
                    "qualified_name": p.qualified_name(),
                    "computer": p.device_name,
                    "kind": p.kind,
                    "provider": p.provider.as_deref().unwrap_or("claude"),
                    "cwd": p.cwd,
                    "model": p.model,
                    "status": p.status,
                    "busy": p.busy,
                    "awaiting_user_input": p.awaiting_user,
                    "queued_messages": if p.remote_device_id.is_none() && p.provider.as_deref() == Some("codex") {
                        crate::codex::pending_panel_messages(app, &p.id)
                    } else { 0 },
                    "reachable": p.reachable(),
                    "is_self": p.id == caller_id,
                })
            })
            .collect()
    });
    let others = panels
        .iter()
        .filter(|p| p["is_self"] != json!(true))
        .count();
    Ok(json!({ "panels": panels, "other_panel_count": others }))
}

/// Shared lookup + guard rails for the two tools that take a `panel` argument.
fn resolve_target(
    bus: &PanelBus,
    caller_id: &str,
    args: &Value,
) -> Result<super::registry::PanelInfo, String> {
    let reference = args
        .get("panel")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if reference.is_empty() {
        return Err("`panel` is required — call list_panels first".into());
    }

    let target = bus.with_registry(|r| match r.resolve(&reference) {
        Resolution::One(p) => Ok(*p),
        Resolution::Ambiguous(candidates) => {
            let list = candidates
                .iter()
                .map(|c| format!("{} (id {})", c.name, short(&c.id)))
                .collect::<Vec<_>>()
                .join(", ");
            Err(format!(
                "more than one panel is called \"{}\": {}. Use the id instead.",
                reference, list
            ))
        }
        Resolution::NotFound => {
            let names = r
                .all()
                .iter()
                .filter(|p| p.id != caller_id)
                .map(|p| p.name.clone())
                .collect::<Vec<_>>();
            if names.is_empty() {
                Err("there are no other panels open in this window".into())
            } else {
                Err(format!(
                    "no panel called \"{}\". Open panels: {}",
                    reference,
                    names.join(", ")
                ))
            }
        }
    })?;

    if target.id == caller_id {
        return Err("that is this panel — a panel cannot message itself".into());
    }
    Ok(target)
}

async fn send_to_panel(app: &AppHandle, caller_id: &str, args: Value) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    let target = resolve_target(&bus, caller_id, &args)?;

    let message = args
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if message.is_empty() {
        return Err("`message` is required".into());
    }
    if !target.reachable() {
        return Err(format!(
            "panel \"{}\" is a {} panel and cannot receive messages",
            target.name, target.kind
        ));
    }

    // Retain hop provenance without cutting off an authorized conversation.
    let hop = bus.next_hop(caller_id);

    let sender_name = bus
        .with_registry(|r| r.get(caller_id).map(|p| p.name.clone()))
        .unwrap_or_else(|| "another panel".to_string());

    if let (Some(device_id), Some(remote_panel_id)) =
        (&target.remote_device_id, &target.remote_panel_id)
    {
        let sender = bus
            .with_registry(|r| r.get(caller_id).cloned())
            .ok_or("Sending panel is no longer open")?;
        let result = app
            .state::<crate::lan::LanManager>()
            .send_remote(device_id, remote_panel_id, &sender, &message, hop)
            .await?;
        bus.record_inbound_hop(&target.id, hop);
        return Ok(json!({
            "delivered": true,
            "panel": target.name,
            "computer": target.device_name,
            "remote_result": result,
            "note": "Delivered over the encrypted local-network connection. Remote sends are nonblocking; use read_panel for the reply."
        }));
    }

    let wrapped = format!(
        "[panel-message from \"{}\" · hop {}]\n{}",
        sender_name, hop, message
    );

    let wait = args
        .get("wait_for_reply")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let wait_guard = if wait {
        bus.begin_wait(caller_id, &target.id)
    } else {
        None
    };
    let wait = wait_guard.is_some();

    if target.provider.as_deref() == Some("opencode") {
        bus.record_inbound_hop(&target.id, hop);
        return crate::opencode::deliver(app, &target.id, &wrapped, wait, args.get("timeout_seconds").and_then(Value::as_u64).unwrap_or(DEFAULT_WAIT_SECS)).await;
    }
    if target.provider.as_deref() == Some("codex") {
        bus.record_inbound_hop(&target.id, hop);
        return crate::codex::deliver(
            app,
            &target.id,
            &wrapped,
            wait,
            args.get("timeout_seconds")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_WAIT_SECS),
        )
        .await;
    }

    if target.kind == "terminal" {
        let result = deliver_to_terminal(app, &target, &wrapped, wait).await?;
        bus.record_inbound_hop(&target.id, hop);
        return Ok(result);
    }

    let stream_state = app.state::<StreamJsonManager>();
    // A panel in a collapsed group never mounted its ChatView, so it may never
    // have been configured. Do it from the registry rather than failing.
    crate::stream::manager::ensure_configured(
        &stream_state,
        &target.id,
        &target.cwd,
        target.model.clone(),
    )?;

    // Register the watcher BEFORE writing, or a fast turn can complete first.
    let watcher = if wait {
        Some(crate::stream::manager::watch_turn(
            &stream_state,
            &target.id,
        )?)
    } else {
        None
    };

    let started = std::time::Instant::now();
    crate::stream::manager::send_user_turn(&target.id, &wrapped, None, app, &stream_state)?;
    bus.record_inbound_hop(&target.id, hop);
    echo_into_transcript(app, &target.id, &wrapped);

    let Some(watcher) = watcher else {
        return Ok(json!({
            "delivered": true,
            "panel": target.name,
            "panel_id": target.id,
            "hop": hop,
            "note": "Delivered. Call read_panel later if you want to see the answer.",
        }));
    };

    let secs = args
        .get("timeout_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_WAIT_SECS)
        .clamp(5, MAX_WAIT_SECS);

    match tokio::time::timeout(std::time::Duration::from_secs(secs), watcher).await {
        Ok(Ok(TurnOutcome::Done {
            is_error,
            subtype,
            text,
        })) => Ok(json!({
            "delivered": true,
            "panel": target.name,
            "reply": text,
            "is_error": is_error,
            "subtype": subtype,
            "took_ms": started.elapsed().as_millis() as u64,
        })),
        Ok(Ok(TurnOutcome::BlockedOnUser)) => Ok(json!({
            "delivered": true,
            "panel": target.name,
            "status": "awaiting_user_input",
            "note": "That panel is waiting for the person to answer a permission prompt or question, \
        so it cannot reply yet. The message was delivered.",
        })),
        Ok(Ok(TurnOutcome::ProcessDied)) => Ok(json!({
            "delivered": true,
            "panel": target.name,
            "status": "process_ended",
            "note": "That panel's Claude process ended before replying.",
        })),
        Ok(Err(_)) => Ok(json!({
            "delivered": true,
            "panel": target.name,
            "status": "unknown",
            "note": "Delivered, but the reply channel closed before an answer arrived.",
        })),
        Err(_) => Ok(json!({
            "delivered": true,
            "panel": target.name,
            "status": "timed_out",
            "waited_seconds": secs,
            "note": "The message was delivered but that panel had not finished within the timeout. \
        Use read_panel later to see what it said.",
        })),
    }
}

async fn deliver_to_terminal(
    app: &AppHandle,
    target: &super::registry::PanelInfo,
    text: &str,
    wait: bool,
) -> Result<Value, String> {
    let pty = app.state::<PtyManager>();
    if target.awaiting_user {
        return Err("That panel is waiting for a permission response or question; a message cannot answer that prompt.".into());
    }
    crate::pty::manager::submit_to_instance(&pty, &target.id, text).await?;
    Ok(json!({
        "delivered": true,
        "panel": target.name,
        "delivery": "best_effort",
        "note": if wait {
            "Pasted the message and sent Enter. Terminal panels give no completion signal, \
    so wait_for_reply was ignored — use read_panel or ask the person."
        } else {
            "Pasted the message and sent Enter. Terminal panels give no completion signal."
        },
    }))
}

async fn read_panel(app: &AppHandle, caller_id: &str, args: Value) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    let target = resolve_target(&bus, caller_id, &args)?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .clamp(1, 100) as usize;

    if let (Some(device_id), Some(remote_panel_id)) =
        (&target.remote_device_id, &target.remote_panel_id)
    {
        return app
            .state::<crate::lan::LanManager>()
            .read_remote(device_id, remote_panel_id, limit)
            .await;
    }

    read_local(app, &target.id, limit).await
}

/// Deliver a request received over an authenticated LAN connection into a
/// local panel. It deliberately cannot target another remote panel, so peers
/// cannot turn Tessera into a transitive relay.
pub async fn deliver_inbound(
    app: &AppHandle,
    target_id: &str,
    wrapped: &str,
) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    let target = bus
        .with_registry(|r| r.get(target_id).cloned())
        .ok_or("Target panel is no longer open")?;
    if target.remote_device_id.is_some() {
        return Err("Transitive LAN panel routing is not allowed".into());
    }
    if !target.reachable() {
        return Err(format!("panel \"{}\" cannot receive messages", target.name));
    }
    if target.provider.as_deref() == Some("opencode") {
        return crate::opencode::deliver(app, &target.id, wrapped, false, DEFAULT_WAIT_SECS).await;
    }
    if target.provider.as_deref() == Some("codex") {
        return crate::codex::deliver(app, &target.id, wrapped, false, DEFAULT_WAIT_SECS).await;
    }
    if target.kind == "terminal" {
        return deliver_to_terminal(app, &target, wrapped, false).await;
    }
    let stream_state = app.state::<StreamJsonManager>();
    crate::stream::manager::ensure_configured(
        &stream_state,
        &target.id,
        &target.cwd,
        target.model.clone(),
    )?;
    crate::stream::manager::send_user_turn(&target.id, wrapped, None, app, &stream_state)?;
    echo_into_transcript(app, &target.id, wrapped);
    Ok(json!({"delivered":true,"panel":target.name}))
}

/// Read only a local panel. Used by both the MCP tool and the LAN request
/// handler, with the same transcript implementation and limits.
pub async fn read_local(app: &AppHandle, target_id: &str, limit: usize) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    let target = bus
        .with_registry(|r| r.get(target_id).cloned())
        .ok_or("Target panel is no longer open")?;
    if target.remote_device_id.is_some() {
        return Err("Transitive LAN panel reads are not allowed".into());
    }

    if target.provider.as_deref() == Some("opencode") {
        let messages = crate::opencode::read_recent(app, &target.id, limit).await?;
        return Ok(json!({"panel":target.name,"messages":messages}));
    }
    if target.provider.as_deref() == Some("codex") {
        let messages = crate::codex::read_recent(app, &target.id, limit).await?;
        return Ok(json!({"panel":target.name,"messages":messages}));
    }

    // Prefer the live session id the stream manager refreshes from every
    // system/init event; fall back to whatever the registry last mirrored.
    let session_id = crate::stream::manager::session_id_of(app, &target.id)
        .or_else(|| bus.with_registry(|r| r.get(&target.id).and_then(|p| p.session_id.clone())));

    let Some(session_id) = session_id else {
        return Ok(json!({
            "panel": target.name,
            "messages": [],
            "note": "That panel has no conversation yet.",
        }));
    };

    let messages = crate::sessions::history_loader::read_recent(&target.cwd, &session_id, limit)?;
    Ok(json!({ "panel": target.name, "messages": messages }))
}

/// Best-effort UI echo so the injected turn shows up in the target's transcript.
fn echo_into_transcript(app: &AppHandle, target_id: &str, text: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let id_json = serde_json::to_string(target_id).unwrap_or_default();
    let text_json = serde_json::to_string(text).unwrap_or_default();
    let js = format!(
        "window.__panelInject && window.__panelInject({}, {})",
        id_json, text_json
    );
    let _ = window.eval(&js);
}

fn short(id: &str) -> String {
    id.chars().take(8).collect()
}

/// Tool name prefix the CLI uses for this server, e.g. `mcp__panels`.
pub fn tool_prefix() -> String {
    format!("mcp__{}", SERVER_NAME)
}
