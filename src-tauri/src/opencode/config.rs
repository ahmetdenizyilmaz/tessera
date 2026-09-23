use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub cwd: String,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub executable_path: String,
    pub permission: String,
    pub agent: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default = "context_default")]
    pub context_limit: u32,
    #[serde(default = "output_default")]
    pub output_limit: u32,
    #[serde(default)]
    pub project_config: bool,
    /// Stable storage identity, independent of a restored panel's new UI id.
    pub data_id: String,
}
fn context_default() -> u32 {
    32768
}
fn output_default() -> u32 {
    4096
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !std::path::Path::new(&self.cwd).is_dir() {
            return Err("Choose an existing project folder for OpenCode.".into());
        }
        if ![
            "openrouter",
            "openai",
            "anthropic",
            "gemini",
            "ollama",
            "lmstudio",
            "custom",
        ]
        .contains(&self.provider.as_str())
        {
            return Err("Unsupported OpenCode provider.".into());
        }
        if !["ask", "allow"].contains(&self.permission.as_str())
            || !["build", "plan"].contains(&self.agent.as_str())
        {
            return Err("Invalid OpenCode permissions or agent.".into());
        }
        if uuid::Uuid::parse_str(&self.data_id).is_err() {
            return Err("Invalid OpenCode storage identity.".into());
        }
        if self.model.trim().is_empty()
            || self.model.len() > 256
            || self.model.chars().any(char::is_control)
        {
            return Err("Choose a model ID.".into());
        }
        if self.context_limit < 4096
            || self.output_limit < 256
            || self.output_limit >= self.context_limit
        {
            return Err("Context must be at least 4096 tokens and larger than the output limit (minimum 256).".into());
        }
        self.endpoint()?;
        Ok(())
    }
    pub fn compatible(&self) -> bool {
        ["ollama", "lmstudio", "custom"].contains(&self.provider.as_str())
    }
    pub fn provider_id(&self) -> &str {
        match self.provider.as_str() {
            "gemini" => "google",
            "ollama" | "lmstudio" | "custom" => "tessera-local",
            p => p,
        }
    }
    pub fn endpoint(&self) -> Result<String, String> {
        let raw = match self.provider.as_str() {
            "openrouter" => "https://openrouter.ai/api/v1",
            "openai" => "https://api.openai.com/v1",
            "anthropic" => "https://api.anthropic.com/v1",
            "gemini" => "https://generativelanguage.googleapis.com/v1beta",
            "ollama" if self.base_url.trim().is_empty() => "http://127.0.0.1:11434/v1",
            "lmstudio" if self.base_url.trim().is_empty() => "http://127.0.0.1:1234/v1",
            _ => self.base_url.trim(),
        };
        let url = reqwest::Url::parse(raw)
            .map_err(|_| "Enter a valid HTTP(S) API base URL.".to_string())?;
        if !["http", "https"].contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Use an HTTP(S) API base URL without credentials, query, or fragment. Store keys in the keychain.".into());
        }
        let mut endpoint = raw.trim_end_matches('/').to_string();
        if self.compatible() && url.path().trim_matches('/').is_empty() {
            endpoint.push_str("/v1");
        }
        Ok(endpoint)
    }
    pub fn key_slot(&self) -> Result<String, String> {
        Ok(if self.compatible() {
            format!("opencode:{}", self.endpoint()?)
        } else {
            self.provider.clone()
        })
    }
    pub fn runtime_config(&self) -> Result<Value, String> {
        let mut options = json!({"apiKey":"{env:TESSERA_OPENCODE_API_KEY}"});
        if self.compatible() {
            options["baseURL"] = json!(self.endpoint()?);
        }
        let mut provider = json!({"options":options});
        if self.compatible() {
            provider["npm"] = json!("@ai-sdk/openai-compatible");
            provider["name"] = json!(format!("Tessera · {}", self.provider));
            provider["models"] = json!({self.model.clone(): {"name":self.model, "tool_call":true, "limit":{"context":self.context_limit,"output":self.output_limit}}});
        }
        let permission = if self.permission == "allow" {
            json!("allow")
        } else {
            json!({"*":"ask", "read":"allow", "glob":"allow", "grep":"allow", "list":"allow", "question":"allow", "todoread":"allow", "todowrite":"allow"})
        };
        let config = json!({
            "$schema":"https://opencode.ai/config.json", "autoupdate":false, "share":"disabled",
            "model": format!("{}/{}",self.provider_id(),self.model),
            "small_model": format!("{}/{}",self.provider_id(),self.model),
            "enabled_providers":[self.provider_id()], "provider":{self.provider_id():provider},
            "default_agent":self.agent, "permission":permission,
        });
        Ok(config)
    }
}

/// An allowlist prevents inherited Claude gateway/API variables, OpenCode login,
/// proxies and parent-agent execution context from leaking into this engine.
pub fn environment(
    config: &Config,
    root: &std::path::Path,
    password: &str,
    key: &str,
    runtime: Value,
) -> HashMap<String, String> {
    let allowed = [
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
        "TMPDIR",
        "USERPROFILE",
        "HOME",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "PROGRAMDATA",
        "LANG",
        "LC_ALL",
        "SSH_AUTH_SOCK",
        "GIT_SSH",
        "GIT_SSH_COMMAND",
    ];
    let mut env: HashMap<String, String> = std::env::vars()
        .filter(|(k, _)| allowed.contains(&k.to_uppercase().as_str()))
        .collect();
    for (k, dir) in [
        ("XDG_DATA_HOME", "data"),
        ("XDG_CONFIG_HOME", "config"),
        ("XDG_STATE_HOME", "state"),
        ("XDG_CACHE_HOME", "cache"),
    ] {
        env.insert(k.into(), root.join(dir).to_string_lossy().into());
    }
    env.insert("OPENCODE_CONFIG_CONTENT".into(), runtime.to_string());
    env.insert(
        "OPENCODE_DISABLE_PROJECT_CONFIG".into(),
        (!config.project_config).to_string(),
    );
    env.insert("OPENCODE_PURE".into(), (!config.project_config).to_string());
    env.insert("OPENCODE_DISABLE_AUTOUPDATE".into(), "true".into());
    env.insert("OPENCODE_DISABLE_TERMINAL_TITLE".into(), "true".into());
    env.insert("OPENCODE_SERVER_PASSWORD".into(), password.into());
    env.insert("OPENCODE_SERVER_USERNAME".into(), "opencode".into());
    env.insert("TESSERA_OPENCODE_API_KEY".into(), key.into());
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    env
}

#[cfg(test)]
mod tests {
    use super::*;
    pub fn fixture() -> Config {
        Config {
            cwd: std::env::temp_dir().to_string_lossy().into(),
            provider: "ollama".into(),
            model: "qwen/coder".into(),
            base_url: "http://localhost:11434/".into(),
            executable_path: String::new(),
            permission: "ask".into(),
            agent: "build".into(),
            instructions: String::new(),
            context_limit: 32768,
            output_limit: 4096,
            project_config: false,
            data_id: uuid::Uuid::new_v4().to_string(),
        }
    }
    #[test]
    fn config_keeps_engine_and_model_separate() {
        let c = fixture();
        let v = c.runtime_config().unwrap();
        assert_eq!(v["model"], "tessera-local/qwen/coder");
        assert_eq!(
            v["provider"]["tessera-local"]["options"]["baseURL"],
            "http://localhost:11434/v1"
        );
        assert_eq!(v["permission"]["*"], "ask");
        assert_eq!(v["share"], "disabled");
    }
    #[test]
    fn validates_storage_and_urls() {
        let mut c = fixture();
        assert!(c.validate().is_ok());
        c.data_id = "../../elsewhere".into();
        assert!(c.validate().is_err());
        c = fixture();
        c.base_url = "http://secret@example.com/v1".into();
        assert!(c.validate().is_err());
        c = fixture();
        c.base_url = "http://localhost:1234/v1/".into();
        assert_eq!(c.endpoint().unwrap(), "http://localhost:1234/v1");
        c.provider = "openrouter".into();
        c.model = "vendor/model".into();
        assert_eq!(
            c.runtime_config().unwrap()["model"],
            "openrouter/vendor/model"
        );
        assert_eq!(c.key_slot().unwrap(), "openrouter");
    }
    #[test]
    fn environment_is_scoped_and_has_no_claude_gateway() {
        let c = fixture();
        let e = environment(
            &c,
            &std::env::temp_dir(),
            "test-password",
            "test-key",
            c.runtime_config().unwrap(),
        );
        assert!(!e.contains_key("ANTHROPIC_BASE_URL"));
        assert!(!e.contains_key("CLAUDECODE"));
        assert_eq!(e["OPENCODE_DISABLE_PROJECT_CONFIG"], "true");
        assert!(!e["OPENCODE_CONFIG_CONTENT"].contains("test-key"));
    }
}
