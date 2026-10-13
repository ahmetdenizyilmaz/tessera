//! Bounded, asynchronous favicon requests from the trusted Tessera UI.
//! Website panels have no access to these commands or to the app's cookies.
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IconResourceKind { Document, Image }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IconResource { url: String, content_type: String, body: String }

fn allowed(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
        && url.username().is_empty() && url.password().is_none()
}

#[tauri::command]
pub async fn website_icon_fetch(url: String, kind: IconResourceKind) -> Result<IconResource, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid website address")?;
    if !allowed(&url) { return Err("Website icons require an http or https address without credentials".into()); }
    let client = reqwest::Client::builder()
        .user_agent("Tessera/0.4 website-icon")
        .connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed(attempt.url()) {
                attempt.error("Unsupported icon redirect")
            } else { attempt.follow() }
        })).build().map_err(|e| e.to_string())?;
    let mut response = client.get(url).header(reqwest::header::ACCEPT, match kind {
        IconResourceKind::Document => "text/html,application/xhtml+xml",
        IconResourceKind::Image => "image/*",
    }).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    // reqwest can leave an unsupported redirect unfollowed. A 3xx body is
    // not a successful page/icon response, even though error_for_status allows it.
    if !response.status().is_success() { return Err("Website did not return an icon resource".into()); }
    let final_url = response.url().to_string();
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok())
        .unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let limit = match kind { IconResourceKind::Document => 512 * 1024, IconResourceKind::Image => 1024 * 1024 };
    if matches!(kind, IconResourceKind::Image) && response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Website icon is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        let remaining = limit - bytes.len();
        if chunk.len() > remaining && matches!(kind, IconResourceKind::Image) { return Err("Website icon is too large".into()); }
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        // Icons live in the head, so a document prefix is enough, even on a
        // very large page. Never buffer an unbounded site response in the UI.
        if bytes.len() == limit { break; }
    }
    let body = match kind {
        IconResourceKind::Document => String::from_utf8_lossy(&bytes).into_owned(),
        IconResourceKind::Image => base64::engine::general_purpose::STANDARD.encode(bytes),
    };
    Ok(IconResource { url: final_url, content_type, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn serve(response: String) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096]; stream.read(&mut request).await.unwrap();
            let _ = stream.write_all(response.as_bytes()).await;
        });
        (url, task)
    }

    #[tokio::test]
    async fn limits_html_and_rejects_oversized_icons() {
        let html = "x".repeat(600 * 1024);
        let (url, task) = serve(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len())).await;
        let response = website_icon_fetch(url.clone(), IconResourceKind::Document).await.unwrap();
        assert_eq!(response.url, url); assert_eq!(response.body.len(), 512 * 1024); task.await.unwrap();
        let (url, task) = serve("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 2000000\r\nConnection: close\r\n\r\n".into()).await;
        assert!(website_icon_fetch(url, IconResourceKind::Image).await.unwrap_err().contains("too large")); task.await.unwrap();
    }

    #[tokio::test]
    async fn transports_icon_bytes_and_rejects_failed_responses() {
        let (url, task) = serve("HTTP/1.1 200 OK\r\nContent-Type: image/x-icon\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest".into()).await;
        let response = website_icon_fetch(url, IconResourceKind::Image).await.unwrap();
        assert_eq!(response.body, "dGVzdA=="); assert_eq!(response.content_type, "image/x-icon"); task.await.unwrap();
        let (url, task) = serve("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()).await;
        assert!(website_icon_fetch(url, IconResourceKind::Image).await.is_err()); task.await.unwrap();
    }

    #[tokio::test]
    async fn rejects_non_web_addresses_and_unsafe_redirects() {
        for url in ["file:///C:/secret", "data:image/png;base64,AA==", "https://user:secret@example.test/"] {
            assert!(website_icon_fetch(url.into(), IconResourceKind::Image).await.is_err());
        }
        let (url, task) = serve("HTTP/1.1 302 Found\r\nLocation: file:///C:/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()).await;
        assert!(website_icon_fetch(url, IconResourceKind::Image).await.is_err()); task.await.unwrap();
    }
}
