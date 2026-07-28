use serde::{Deserialize, Serialize};

use super::keyring_store;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub email: String,
    pub name: Option<String>,
    pub access_token: String,
    pub server_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    access_token: Option<String>,
    email: Option<String>,
    name: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn auth_login(
    email: String,
    password: String,
    server_url: String,
) -> Result<AuthUser, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/auth/login", server_url);

    let body = serde_json::json!({
        "email": email,
        "password": password,
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Login request failed: {}", e))?;

    let status = resp.status();
    let auth_resp: AuthResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse login response: {}", e))?;

    if !status.is_success() {
        return Err(auth_resp.error.unwrap_or_else(|| format!("Login failed with status {}", status)));
    }

    let token = auth_resp
        .access_token
        .ok_or_else(|| "No access token in response".to_string())?;

    // Store in keyring
    keyring_store::set_access_token(&token)?;
    keyring_store::set_server_url(&server_url)?;

    Ok(AuthUser {
        email: auth_resp.email.unwrap_or(email),
        name: auth_resp.name,
        access_token: token,
        server_url,
    })
}

#[tauri::command]
pub async fn auth_register(
    email: String,
    password: String,
    name: String,
    server_url: String,
) -> Result<AuthUser, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/auth/register", server_url);

    let body = serde_json::json!({
        "email": email,
        "password": password,
        "name": name,
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Register request failed: {}", e))?;

    let status = resp.status();
    let auth_resp: AuthResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse register response: {}", e))?;

    if !status.is_success() {
        return Err(auth_resp.error.unwrap_or_else(|| format!("Registration failed with status {}", status)));
    }

    let token = auth_resp
        .access_token
        .ok_or_else(|| "No access token in response".to_string())?;

    // Store in keyring
    keyring_store::set_access_token(&token)?;
    keyring_store::set_server_url(&server_url)?;

    Ok(AuthUser {
        email: auth_resp.email.unwrap_or(email),
        name: auth_resp.name.or(Some(name)),
        access_token: token,
        server_url,
    })
}

#[tauri::command]
pub async fn auth_logout() -> Result<(), String> {
    keyring_store::delete_access_token()?;
    keyring_store::delete_server_url()?;
    Ok(())
}

#[tauri::command]
pub async fn auth_check() -> Result<Option<AuthUser>, String> {
    let token = match keyring_store::get_access_token().await? {
        Some(t) => t,
        None => return Ok(None),
    };

    let server_url = match keyring_store::get_server_url().await? {
        Some(u) => u,
        None => return Ok(None),
    };

    // Verify token with server
    let client = reqwest::Client::new();
    let url = format!("{}/auth/me", server_url);

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => {
            let auth_resp: AuthResponse = r
                .json()
                .await
                .map_err(|e| format!("Failed to parse auth check response: {}", e))?;

            Ok(Some(AuthUser {
                email: auth_resp.email.unwrap_or_default(),
                name: auth_resp.name,
                access_token: token,
                server_url,
            }))
        }
        _ => {
            // Token invalid or server unreachable - still return token info for offline use
            Ok(Some(AuthUser {
                email: String::new(),
                name: None,
                access_token: token,
                server_url,
            }))
        }
    }
}
