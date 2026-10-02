//! `Tessera.exe --panel-mcp-bridge`: a stdio MCP server that forwards to this
//! app's loopback panel bus.
//!
//! Some CLIs (Antigravity's `agy`) load MCP servers only from one global file
//! and cannot be handed a per-session URL. They do pass their own environment
//! on to stdio servers, so Tessera starts each panel's CLI with that panel's
//! bus address and token, and this bridge turns the global entry back into a
//! per-panel connection. Started by anything else, it is an empty server.
use serde_json::{json, Value};
use std::io::{BufRead, Write};

pub const FLAG: &str = "--panel-mcp-bridge";
pub const URL_ENV: &str = "TESSERA_PANEL_BUS_URL";
pub const TOKEN_ENV: &str = "TESSERA_PANEL_BUS_TOKEN";

fn error(id: Value, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":message}})
}

/// Replies for a session Tessera did not start: valid MCP, no tools.
pub fn offline_reply(request: &Value) -> Option<Value> {
    let id = request.get("id")?.clone();
    let result = match request["method"].as_str() {
        Some("initialize") => json!({
            "protocolVersion": request["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": {"tools": {"listChanged": false}},
            "serverInfo": {"name": "tessera-panels", "version": env!("CARGO_PKG_VERSION")},
            "instructions": "This session was not started from a Tessera panel, so Tessera's panel tools are not available here.",
        }),
        Some("tools/list") => json!({"tools": []}),
        Some("ping") => json!({}),
        _ => return Some(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"not available outside a Tessera panel"}})),
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}

async fn forward(client: &reqwest::Client, url: &str, token: &str, request: &Value) -> Option<Value> {
    let response = client.post(url).bearer_auth(token).json(request).send().await;
    // Notifications get no reply, whatever happened to them.
    let id = request.get("id")?.clone();
    Some(match response {
        Ok(response) if response.status().is_success() => response
            .json::<Value>()
            .await
            .unwrap_or_else(|_| error(id, "Tessera returned an unreadable reply.")),
        Ok(response) => error(id, &format!(
            "Tessera refused this panel's request (HTTP {}). The panel was closed or Tessera restarted: restart this Antigravity panel.",
            response.status().as_u16()
        )),
        Err(_) => error(id, "Tessera is not reachable. It was closed or restarted: restart this Antigravity panel from Tessera."),
    })
}

/// Runs until stdin closes. Returns the process exit code.
pub fn run() -> i32 {
    let target = std::env::var(URL_ENV)
        .ok()
        .zip(std::env::var(TOKEN_ENV).ok())
        // Loopback only: this process must never carry a panel token anywhere else.
        .filter(|(url, token)| url.starts_with("http://127.0.0.1:") && !token.is_empty());
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
        return 1;
    };
    // send_to_panel can wait up to 300 seconds for the other panel's reply.
    let Ok(client) = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(330)).build() else {
        return 1;
    };
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(request) = serde_json::from_str::<Value>(line.trim_start_matches('\u{feff}')) else {
            continue;
        };
        let reply = match &target {
            Some((url, token)) => runtime.block_on(forward(&client, url, token, &request)),
            None => offline_reply(&request),
        };
        if let Some(reply) = reply {
            if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
                break;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_tessera_the_bridge_is_a_valid_server_with_no_tools() {
        let init = offline_reply(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}})).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["id"], 1);
        assert_eq!(offline_reply(&json!({"id":"a","method":"tools/list"})).unwrap()["result"]["tools"], json!([]));
        // Nothing can be called, and notifications are never answered.
        assert_eq!(offline_reply(&json!({"id":2,"method":"tools/call","params":{"name":"send_to_panel"}})).unwrap()["error"]["code"], -32601);
        assert!(offline_reply(&json!({"method":"notifications/initialized"})).is_none());
    }

    #[tokio::test]
    async fn an_unreachable_or_refusing_tessera_is_reported_to_the_agent_not_hidden() {
        let client = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(5)).build().unwrap();
        // A closed loopback port: Tessera is not running any more.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}/mcp/panel", listener.local_addr().unwrap().port());
        drop(listener);
        let reply = forward(&client, &url, "token", &json!({"id":7,"method":"tools/list"})).await.unwrap();
        assert_eq!(reply["id"], 7);
        assert!(reply["error"]["message"].as_str().unwrap().contains("not reachable"));
        assert!(forward(&client, &url, "token", &json!({"method":"notifications/initialized"})).await.is_none());
    }
}
