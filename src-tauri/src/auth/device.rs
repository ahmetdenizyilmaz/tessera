use keyring::Entry;
use serde::Deserialize;

const SERVICE_NAME: &str = "claude-gui";
const DEVICE_ID_KEY: &str = "device_id";

fn get_entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, key).map_err(|e| format!("Keyring error: {}", e))
}

#[tauri::command]
pub async fn get_device_id() -> Result<Option<String>, String> {
    let entry = get_entry(DEVICE_ID_KEY)?;
    match entry.get_password() {
        Ok(id) => Ok(Some(id)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get device ID: {}", e)),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterDeviceResponse {
    device_id: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn register_device(
    server_url: String,
    access_token: String,
    device_name: Option<String>,
    platform: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/devices/register", server_url);

    let hostname = whoami::fallible::hostname().unwrap_or_else(|_| "unknown".to_string());

    let body = serde_json::json!({
        "deviceName": device_name.unwrap_or(hostname),
        "platform": platform.unwrap_or_else(|| std::env::consts::OS.to_string()),
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Device registration failed: {}", e))?;

    let status = resp.status();
    let device_resp: RegisterDeviceResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse device response: {}", e))?;

    if !status.is_success() {
        return Err(device_resp
            .error
            .unwrap_or_else(|| format!("Device registration failed with status {}", status)));
    }

    let device_id = device_resp
        .device_id
        .ok_or_else(|| "No device ID in response".to_string())?;

    // Store device ID in keyring
    let entry = get_entry(DEVICE_ID_KEY)?;
    entry
        .set_password(&device_id)
        .map_err(|e| format!("Failed to store device ID: {}", e))?;

    Ok(device_id)
}
