//! An empty terminal needs a durable thread, not an artificial first turn.
use super::{rpc::Client, Config};
use serde_json::{json, Value};

pub(super) async fn persist_empty_terminal(
    client: &Client,
    config: &Config,
    initial: &mut Value,
) -> Result<(), String> {
    let sid = initial["thread"]["id"]
        .as_str()
        .ok_or("Codex returned no thread ID")?
        .to_owned();
    let project = std::path::Path::new(&config.cwd)
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Session");
    // The native naming API flushes the empty thread's metadata to its rollout.
    // This makes resume possible without a turn/start, placeholder prompt, or
    // manually writing Codex's private history format. Never rename a resume.
    client
        .call(
            "thread/name/set",
            json!({"threadId":sid,"name":format!("Codex · {project}")}),
        )
        .await?;
    let saved = client
        .call("thread/read", json!({"threadId":sid,"includeTurns":true}))
        .await?;
    if saved["thread"]["id"] != sid {
        return Err("Codex saved a different terminal conversation; startup was stopped".into());
    }
    initial["thread"] = saved["thread"].clone();
    Ok(())
}

#[cfg(test)]
#[path = "terminal_startup_tests.rs"]
mod tests;
