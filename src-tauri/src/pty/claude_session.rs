//! SessionStart reports the conversation actually selected by Claude's /resume
//! and /clear commands. Never infer it from the newest transcript in a folder.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub struct ClaudeSessions(Arc<Mutex<HashMap<String, SessionOwner>>>);

struct SessionOwner {
    token: String,
    ids: Arc<Mutex<HashSet<String>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionChanged {
    pub session_id: String,
}

pub struct Registration {
    panel_id: String,
    token: String,
    pub settings_path: PathBuf,
    sessions: ClaudeSessions,
    pub ids: Arc<Mutex<HashSet<String>>>,
}

impl ClaudeSessions {
    pub fn prepare(&self, panel_id: &str, port: u16) -> Result<Registration, String> {
        self.prepare_in(
            panel_id,
            port,
            crate::app_paths::data_dir().join("claude-runtime"),
        )
    }

    fn prepare_in(&self, panel_id: &str, port: u16, dir: PathBuf) -> Result<Registration, String> {
        uuid::Uuid::parse_str(panel_id).map_err(|_| "Invalid Claude panel ID")?;
        let token = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let settings_path = dir.join(format!("{token}.json"));
        // SessionStart supports command hooks, but not HTTP hooks in Claude's
        // native CLI. Forward its JSON stdin to the authenticated local endpoint.
        // Ignore curlrc/proxies so the credential stays on loopback. All
        // interpolated arguments are UUIDs or a numeric port, never a path
        // or conversation content. Use the executable, not PowerShell's alias.
        let curl = if cfg!(target_os = "windows") {
            "curl.exe"
        } else {
            "curl"
        };
        let command = format!("{curl} --disable --silent --noproxy \"*\" --max-time 2 --request POST --header \"Content-Type: application/json\" --header \"Authorization: Bearer {token}\" --data-binary @- \"http://127.0.0.1:{port}/claude-session/{panel_id}\"");
        let settings = json!({ "hooks": { "SessionStart": [{ "hooks": [{
            "type": "command", "command": command, "timeout": 3
        }] }] } });
        std::fs::write(&settings_path, settings.to_string()).map_err(|e| e.to_string())?;
        let ids = Arc::new(Mutex::new(HashSet::new()));
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(panel_id.into(), SessionOwner { token: token.clone(), ids: ids.clone() });
        Ok(Registration {
            panel_id: panel_id.into(),
            token,
            settings_path,
            sessions: self.clone(),
            ids,
        })
    }

    pub fn authorized(&self, panel_id: &str, token: &str) -> bool {
        self.0.lock().is_ok_and(|sessions| {
            sessions
                .get(panel_id)
                .is_some_and(|current| current.token == token)
        })
    }

    pub fn accept(&self, panel_id: &str, token: &str, event: &Value) -> Option<SessionChanged> {
        if event["hook_event_name"] != "SessionStart" {
            return None;
        }
        let session_id = event["session_id"].as_str()?;
        // A brand-new session has no transcript yet; its ID is still durable.
        let session_id = uuid::Uuid::parse_str(session_id).ok()?.to_string();
        // Check the credential and record ownership under the same lock: an old
        // hook must never claim a session for a replacement panel process.
        let sessions = self.0.lock().ok()?;
        let owner = sessions.get(panel_id).filter(|owner| owner.token == token)?;
        owner.ids.lock().ok()?.insert(session_id.clone());
        Some(SessionChanged {
            session_id,
        })
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.0.lock() {
            if sessions.get(&self.panel_id).is_some_and(|owner| owner.token == self.token) {
                sessions.remove(&self.panel_id);
            }
        }
        let _ = std::fs::remove_file(&self.settings_path);
    }
}

#[cfg(test)]
#[path = "claude_session_tests.rs"]
mod native_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_resume_and_clear_without_adopting_another_panels_session() {
        let sessions = ClaudeSessions::default();
        let dir =
            std::env::temp_dir().join(format!("tessera-claude-session-{}", uuid::Uuid::new_v4()));
        let panel = uuid::Uuid::new_v4().to_string();
        let other = uuid::Uuid::new_v4().to_string();
        let first = sessions.prepare_in(&panel, 12345, dir.clone()).unwrap();
        let registration = sessions.prepare_in(&other, 12345, dir.clone()).unwrap();
        let settings: Value =
            serde_json::from_slice(&std::fs::read(&first.settings_path).unwrap()).unwrap();
        assert_eq!(
            settings["hooks"]["SessionStart"][0]["hooks"][0]["type"],
            "command"
        );
        assert!(settings["hooks"]["SessionStart"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("--data-binary @-"));
        for source in ["startup", "resume", "clear", "compact"] {
            let sid = uuid::Uuid::new_v4().to_string();
            let event =
                json!({"hook_event_name":"SessionStart", "source":source, "session_id":sid});
            assert_eq!(
                sessions
                    .accept(&panel, &first.token, &event)
                    .unwrap()
                    .session_id,
                sid
            );
            assert!(sessions.accept(&other, &first.token, &event).is_none());
            assert!(first.ids.lock().unwrap().contains(&sid));
            assert!(registration.ids.lock().unwrap().is_empty());
        }
        let event = json!({"hook_event_name":"SessionStart", "session_id":uuid::Uuid::new_v4().to_string()});
        let replacement = sessions.prepare_in(&panel, 12345, dir.clone()).unwrap();
        assert_eq!(first.ids.lock().unwrap().len(), 4);
        assert!(replacement.ids.lock().unwrap().is_empty());
        assert!(sessions.accept(&panel, &first.token, &event).is_none());
        drop(first);
        assert!(sessions
            .accept(&panel, &replacement.token, &event)
            .is_some());
        assert!(sessions
            .accept(
                &panel,
                &replacement.token,
                &json!({"hook_event_name":"SessionStart", "session_id":"../wrong"})
            )
            .is_none());
        assert!(sessions
            .accept(
                &panel,
                &replacement.token,
                &json!({"hook_event_name":"SubagentStart", "session_id":event["session_id"]})
            )
            .is_none());
        let token = replacement.token.clone();
        drop(replacement);
        drop(registration);
        assert!(!sessions.authorized(&panel, &token));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir(dir).unwrap();
    }
}
