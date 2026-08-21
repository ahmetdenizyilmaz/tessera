use keyring::Entry;

const SERVICE_NAME: &str = "tessera";

fn get_entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, key).map_err(|e| format!("Keyring error: {}", e))
}

#[tauri::command]
pub async fn get_access_token() -> Result<Option<String>, String> {
    let entry = get_entry("access_token")?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get access token: {}", e)),
    }
}

#[tauri::command]
pub async fn get_server_url() -> Result<Option<String>, String> {
    let entry = get_entry("server_url")?;
    match entry.get_password() {
        Ok(url) => Ok(Some(url)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get server URL: {}", e)),
    }
}

pub fn set_access_token(token: &str) -> Result<(), String> {
    let entry = get_entry("access_token")?;
    entry
        .set_password(token)
        .map_err(|e| format!("Failed to set access token: {}", e))
}

pub fn set_server_url(url: &str) -> Result<(), String> {
    let entry = get_entry("server_url")?;
    entry
        .set_password(url)
        .map_err(|e| format!("Failed to set server URL: {}", e))
}

pub fn delete_access_token() -> Result<(), String> {
    let entry = get_entry("access_token")?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete access token: {}", e)),
    }
}

pub fn delete_server_url() -> Result<(), String> {
    let entry = get_entry("server_url")?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete server URL: {}", e)),
    }
}
