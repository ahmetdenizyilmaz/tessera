use keyring::Entry;

const SERVICE_NAME: &str = "claude-gui-llm";

fn get_entry(provider: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, provider).map_err(|e| format!("Keyring error: {}", e))
}

#[tauri::command]
pub async fn llm_get_api_key(provider: String) -> Result<Option<String>, String> {
    let entry = get_entry(&provider)?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get API key: {}", e)),
    }
}

#[tauri::command]
pub async fn llm_set_api_key(provider: String, key: String) -> Result<(), String> {
    let entry = get_entry(&provider)?;
    entry
        .set_password(&key)
        .map_err(|e| format!("Failed to set API key: {}", e))
}

#[tauri::command]
pub async fn llm_delete_api_key(provider: String) -> Result<(), String> {
    let entry = get_entry(&provider)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete API key: {}", e)),
    }
}
