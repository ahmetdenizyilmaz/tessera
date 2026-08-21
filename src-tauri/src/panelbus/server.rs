//! Minimal MCP Streamable-HTTP server on loopback.
//!
//! Only the subset Claude Code's MCP client actually uses is implemented:
//! `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, all
//! as JSON-RPC over `POST /mcp/<panel-id>` with a plain JSON response. We never
//! push server→client notifications, so no SSE stream is needed; `GET` on the
//! endpoint correctly answers 405.

use std::convert::Infallible;

use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use super::{tools, PanelBus};

pub async fn serve(listener: TcpListener, app: AppHandle) {
    loop {
        let (stream, _peer) = match listener.accept().await {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[panelbus] accept failed: {}", e);
                continue;
            }
        };
        let io = TokioIo::new(stream);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let service = service_fn(move |req| handle(req, app.clone()));
            if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
                // Clients disconnect routinely; only worth a line at debug level.
                eprintln!("[panelbus] connection ended: {}", e);
            }
        });
    }
}

fn text_response(status: StatusCode, body: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Full::new(Bytes::from(body.to_string())))
        .unwrap()
}

fn json_response(value: Value) -> Response<Full<Bytes>> {
    let body = serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(body)))
        .unwrap()
}

fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

fn rpc_ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

async fn handle(
    req: Request<Incoming>,
    app: AppHandle,
) -> Result<Response<Full<Bytes>>, Infallible> {
    // Any web page in any browser can POST to a localhost port. The MCP spec's
    // local-server guidance is to refuse anything that carries an Origin —
    // a legitimate MCP client never sends one.
    if req.headers().contains_key(hyper::header::ORIGIN) {
        return Ok(text_response(
            StatusCode::FORBIDDEN,
            "cross-origin requests are not accepted",
        ));
    }

    let path = req.uri().path().to_string();
    let panel_id = match path.strip_prefix("/mcp/") {
        Some(rest) if !rest.is_empty() => rest.trim_end_matches('/').to_string(),
        _ => return Ok(text_response(StatusCode::NOT_FOUND, "not found")),
    };

    // No SSE stream to open and no session state to delete.
    if req.method() != Method::POST {
        return Ok(Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("allow", "POST")
            .body(Full::new(Bytes::new()))
            .unwrap());
    }

    let bus = app.state::<PanelBus>();

    // Per-panel token: the bearer must be the token minted for THIS path's
    // panel id, so reading one panel's config file and POSTing to another
    // panel's URL no longer authenticates.
    let authorized = req
        .headers()
        .get(hyper::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| bus.token_matches(&panel_id, t))
        .unwrap_or(false);
    if !authorized {
        return Ok(text_response(StatusCode::UNAUTHORIZED, "unauthorized"));
    }

    let body = match req.into_body().collect().await {
        Ok(b) => b.to_bytes(),
        Err(e) => {
            return Ok(text_response(
                StatusCode::BAD_REQUEST,
                &format!("could not read body: {}", e),
            ))
        }
    };

    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return Ok(json_response(rpc_error(Value::Null, -32700, "parse error"))),
    };

    // Batches are legal JSON-RPC but Claude Code does not send them; one
    // object keeps this honest rather than silently mishandling an array.
    if parsed.is_array() {
        return Ok(json_response(rpc_error(
            Value::Null,
            -32600,
            "batched requests are not supported",
        )));
    }

    let id = parsed.get("id").cloned().unwrap_or(Value::Null);
    let method = parsed.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = parsed.get("params").cloned().unwrap_or(json!({}));

    // Notifications carry no id and expect no body.
    let is_notification = parsed.get("id").is_none();

    match method {
        "initialize" => {
            // Echo the client's protocol version rather than pinning a date we
            // would then have to chase.
            let version = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("2025-06-18");
            Ok(json_response(rpc_ok(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": {
                        "name": "claude-gui-panels",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Tools for seeing and messaging the other Claude panels open in this Tessera window.",
                }),
            )))
        }
        "notifications/initialized" | "notifications/cancelled" => Ok(Response::builder()
            .status(StatusCode::ACCEPTED)
            .body(Full::new(Bytes::new()))
            .unwrap()),
        "ping" => Ok(json_response(rpc_ok(id, json!({})))),
        "tools/list" => Ok(json_response(rpc_ok(
            id,
            json!({ "tools": tools::definitions() }),
        ))),
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let result = tools::call(&app, &panel_id, name, args).await;
            let (payload, is_error) = match result {
                Ok(v) => (v, false),
                Err(e) => (json!({ "error": e }), true),
            };
            let text = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into());
            Ok(json_response(rpc_ok(
                id,
                json!({
                    "content": [{ "type": "text", "text": text }],
                    "isError": is_error,
                }),
            )))
        }
        _ if is_notification => Ok(Response::builder()
            .status(StatusCode::ACCEPTED)
            .body(Full::new(Bytes::new()))
            .unwrap()),
        other => Ok(json_response(rpc_error(
            id,
            -32601,
            &format!("unknown method: {}", other),
        ))),
    }
}
