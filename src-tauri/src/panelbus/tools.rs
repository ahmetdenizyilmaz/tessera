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
            "description": "List the other Claude panels open in this Claude GUI window, including \
their name, working directory and whether they are currently busy. Use this before messaging \
another panel so you address it correctly.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "send_to_panel",
            "description": "Send a message to another Claude panel in this window. It arrives as a \
user turn in that panel and the person can see it. Returns as soon as it is delivered; pass \
wait_for_reply if you need that panel's answer before continuing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "panel": { "type": "string", "description": "Panel name or id, from list_panels." },
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
            "description": "Read the recent conversation from another Claude panel, so you can pick \
up context without interrupting it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "panel": { "type": "string", "description": "Panel name or id, from list_panels." },
                    "limit": { "type": "number", "description": "How many recent messages to return. Default 20." }
                },
                "required": ["panel"],
                "additionalProperties": false
            }
        }),
    ]
}

pub async fn call(app: &AppHandle, caller_id: &str, name: &str, args: Value) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    if !bus.is_enabled() {
        return Err("panel messaging is switched off in this app's settings".into());
    }
    // The caller identifies itself by the URL it was configured with, not by
    // anything the model can influence.
    if bus.with_registry(|r| r.get(caller_id).is_none()) {
        return Err(format!(
            "this panel ({}) is no longer open, so its tools are inert",
            caller_id
        ));
    }

    match name {
        "list_panels" => list_panels(app, caller_id),
        "send_to_panel" => send_to_panel(app, caller_id, args).await,
        "read_panel" => read_panel(app, caller_id, args),
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
                    "kind": p.kind,
                    "cwd": p.cwd,
                    "model": p.model,
                    "status": p.status,
                    "busy": p.busy,
                    "awaiting_user_input": p.awaiting_user,
                    "reachable": p.reachable(),
                    "is_self": p.id == caller_id,
                })
            })
            .collect()
    });
    let others = panels.iter().filter(|p| p["is_self"] != json!(true)).count();
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
        Resolution::One(p) => Ok(p),
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

    // Loop control. Hop depth is tracked server-side against the calling panel
    // id; a model that rewrites the message text cannot reset it.
    let hop = bus.next_hop(caller_id);
    if PanelBus::hop_exceeded(hop) {
        return Err(format!(
            "message chain is {} panels deep (limit {}) — stopping here to avoid a loop. \
Answer in your own panel instead of forwarding again.",
            hop,
            PanelBus::max_hop()
        ));
    }
    bus.check_rate(caller_id)?;

    let sender_name = bus
        .with_registry(|r| r.get(caller_id).map(|p| p.name.clone()))
        .unwrap_or_else(|| "another panel".to_string());
    let wrapped = format!(
        "[panel-message from \"{}\" · hop {}]\n{}",
        sender_name, hop, message
    );

    let wait = args
        .get("wait_for_reply")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if target.kind == "terminal" {
        return deliver_to_terminal(app, &target, &wrapped, wait);
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
        Some(crate::stream::manager::watch_turn(&stream_state, &target.id)?)
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
        Ok(Ok(TurnOutcome::Done { is_error, subtype, text })) => Ok(json!({
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

fn deliver_to_terminal(
    app: &AppHandle,
    target: &super::registry::PanelInfo,
    text: &str,
    wait: bool,
) -> Result<Value, String> {
    let pty = app.state::<PtyManager>();
    // Terminal panels drive the interactive TUI, so this is literally typing.
    // A trailing CR submits the line.
    let line = format!("{}\r", text.replace('\n', " "));
    crate::pty::manager::write_to_instance(&pty, &target.id, &line)?;
    Ok(json!({
        "delivered": true,
        "panel": target.name,
        "delivery": "best_effort",
        "note": if wait {
            "Typed into that panel's terminal. Terminal panels give no completion signal, \
so wait_for_reply was ignored — use read_panel or ask the person."
        } else {
            "Typed into that panel's terminal. Terminal panels give no completion signal."
        },
    }))
}

fn read_panel(app: &AppHandle, caller_id: &str, args: Value) -> Result<Value, String> {
    let bus = app.state::<PanelBus>();
    let target = resolve_target(&bus, caller_id, &args)?;
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(20)
        .clamp(1, 100) as usize;

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
