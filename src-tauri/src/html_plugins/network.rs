//! All plugin network access goes through this bounded, permission-checked broker.
//! DNS answers are validated AND pinned to the request. Proxies and redirects
//! cannot silently take the request to localhost or the private network.
use std::{net::{IpAddr, SocketAddr}, time::Duration};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub fn origin(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid network origin")?;
    if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path() != "/" { return Err("Network permissions must be exact HTTPS origins, e.g. https://api.example.com".into()); }
    if let Ok(ip) = url.host_str().unwrap().trim_matches(['[', ']']).parse::<IpAddr>() { if !public_ip(ip) { return Err("Local/private network access is not available to plugins".into()); } }
    if url.host_str().unwrap().eq_ignore_ascii_case("localhost") || url.host_str().unwrap().ends_with(".localhost") { return Err("Local network access is not available to plugins".into()); }
    Ok(url.origin().ascii_serialization())
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a,b,c,_] = ip.octets();
            !(a == 0 || a == 10 || a == 127 || a >= 224 || (a == 169 && b == 254) || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168) || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0) || (a == 192 && b == 88 && c == 99)
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100))) || (a == 203 && b == 0 && c == 113))
        }
        // Only global unicast; exclude mapped IPv4, transition, documentation,
        // multicast, loopback, link-local and unique-local destinations.
        IpAddr::V6(ip) => { let s = ip.segments(); (s[0] & 0xe000) == 0x2000 && s[0] != 0x2002 && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8)) }
    }
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Request {
    pub url: String,
    #[serde(default = "get")] pub method: String,
    #[serde(default)] pub headers: BTreeMap<String, String>,
    pub body: Option<String>,
}
fn get() -> String { "GET".into() }

#[derive(Debug, Serialize)]
pub struct Response { pub url: String, pub status: u16, pub ok: bool, pub headers: BTreeMap<String,String>, pub body: String }

pub async fn fetch(request: Request, allowed: &[String]) -> Result<Response, String> {
    let mut url = reqwest::Url::parse(&request.url).map_err(|_| "Invalid request URL")?;
    if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].contains(&request.method.as_str()) { return Err("Unsupported HTTP method".into()); }
    if request.url.len() > 8192 || request.body.as_ref().is_some_and(|s| s.len() > 256 * 1024) || request.headers.len() > 24 { return Err("Network request is too large".into()); }
    let mut headers = reqwest::header::HeaderMap::new();
    for (key,value) in request.headers {
        let key = reqwest::header::HeaderName::from_bytes(key.as_bytes()).map_err(|_| "Invalid header")?;
        if value.len() > 8192 || ["host", "cookie", "origin", "referer", "connection", "content-length", "transfer-encoding", "upgrade", "te", "trailer", "forwarded", "via"].contains(&key.as_str())
            || key.as_str().starts_with("sec-") || key.as_str().starts_with("proxy-") || key.as_str().starts_with("x-forwarded-") { return Err("Unsupported request header".into()); }
        headers.insert(key, reqwest::header::HeaderValue::from_str(&value).map_err(|_| "Invalid header value")?);
    }
    let mut method = reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "Invalid HTTP method")?;
    let mut body = request.body;
    for redirect in 0..=3 {
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || !allowed.contains(&url.origin().ascii_serialization()) { return Err("This network origin has not been granted to the plugin".into()); }
        let host = url.host_str().ok_or("Missing host")?.trim_matches(['[', ']']).to_string();
        let port = url.port_or_known_default().ok_or("Missing port")?;
        let addresses: Vec<SocketAddr> = tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((host.as_str(), port)))
            .await.map_err(|_| "DNS lookup timed out")?.map_err(|e| e.to_string())?.collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) { return Err("Local, private and reserved addresses are blocked".into()); }
        let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(15)).resolve_to_addrs(&host, &addresses)
            .build().map_err(|e| e.to_string())?;
        let mut builder = client.request(method.clone(), url.clone()).headers(headers.clone());
        if let Some(body) = &body { builder = builder.body(body.clone()); }
        let mut response = builder.send().await.map_err(|e| e.to_string())?;
        if [301,302,303,307,308].contains(&response.status().as_u16()) {
            if redirect == 3 { return Err("Too many network redirects".into()); }
            let next = response.headers().get(reqwest::header::LOCATION).and_then(|h| h.to_str().ok()).ok_or("Redirect is missing its destination")?;
            let next = url.join(next).map_err(|_| "Invalid redirect destination")?;
            // Custom headers and request bodies can also contain credentials.
            // Require the app to make an explicit request to a different origin.
            if next.origin() != url.origin() { return Err("Cross-origin redirects are blocked; request the destination explicitly".into()); }
            if response.status().as_u16() == 303 || ([301,302].contains(&response.status().as_u16()) && method == reqwest::Method::POST) { method = reqwest::Method::GET; body = None; headers.remove(reqwest::header::CONTENT_TYPE); }
            url = next; continue;
        }
        const MAX_RESPONSE: usize = 2 * 1024 * 1024;
        if response.content_length().is_some_and(|n| n > MAX_RESPONSE as u64) { return Err("Network response exceeds 2 MB".into()); }
        let status = response.status().as_u16();
        let headers = response.headers().iter().filter(|(k,_)| k.as_str() != "set-cookie").filter_map(|(k,v)| v.to_str().ok().map(|v| (k.to_string(),v.to_string()))).collect();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > MAX_RESPONSE { return Err("Network response exceeds 2 MB".into()); }
            bytes.extend_from_slice(&chunk);
        }
        let body = String::from_utf8(bytes).map_err(|_| "Version 1 network responses must be text or JSON")?;
        return Ok(Response { url: url.to_string(), status, ok: (200..300).contains(&status), headers, body });
    }
    Err("Too many redirects".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn origins_and_internal_addresses_are_rejected() {
        assert_eq!(origin("https://api.example.com/").unwrap(), "https://api.example.com");
        for value in ["http://example.com", "https://user@example.com", "https://example.com/path", "https://example.com?x=1", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://2130706433"] { assert!(origin(value).is_err(), "{value}"); }
        for value in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "172.20.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::1", "2001:db8::1"] { assert!(!public_ip(value.parse().unwrap()), "{value}"); }
        for value in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] { assert!(public_ip(value.parse().unwrap()), "{value}"); }
    }
    #[tokio::test] async fn no_request_without_a_grant() {
        assert!(fetch(Request { url: "https://example.com".into(), method: "GET".into(), headers: BTreeMap::new(), body: None }, &[]).await.unwrap_err().contains("not been granted"));
    }
}
