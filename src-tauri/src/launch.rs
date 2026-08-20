//! CLI launcher plumbing for the `cgui` command.
//!
//! `cgui` (a shim on PATH) launches the app exe with a directory argument.
//! The single-instance plugin makes a second launch forward its argv to the
//! already-running app and exit; both the first launch and every forwarded one
//! funnel a directory into the queue here, which the frontend drains and opens
//! as a new tab.

use std::sync::Mutex;
use tauri::{Manager, WebviewWindow};

const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Default)]
pub struct LaunchQueue {
    dirs: Mutex<Vec<String>>,
}

impl LaunchQueue {
    pub fn push(&self, dir: String) {
        if dir.trim().is_empty() {
            return;
        }
        self.dirs.lock().unwrap_or_else(|e| e.into_inner()).push(dir);
    }

    pub fn drain(&self) -> Vec<String> {
        std::mem::take(&mut *self.dirs.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

/// Pull a launch directory out of a process's argv. The `cgui` shim passes the
/// target directory as the first non-flag argument; ignore anything that
/// doesn't look like a path (defensive — argv[0] is the exe).
pub fn dir_from_argv(argv: &[String]) -> Option<String> {
    argv.iter()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
}

/// Frontend calls this on startup and whenever `window.__drainLaunchDirs()`
/// fires; returns and clears the queued directories.
#[tauri::command]
pub fn take_launch_dirs(state: tauri::State<'_, LaunchQueue>) -> Vec<String> {
    state.drain()
}

/// Nudge the frontend to drain the queue, and bring the window forward — a
/// second `cgui` invocation should surface the app, like clicking a taskbar
/// icon.
pub fn notify_frontend(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.eval("window.__drainLaunchDirs && window.__drainLaunchDirs()");
}

/// The single-instance callback: a second launch lands here in the FIRST
/// process. Queue its directory and wake the frontend.
pub fn on_second_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    if let Some(dir) = dir_from_argv(&argv) {
        if let Some(q) = app.try_state::<LaunchQueue>() {
            q.push(dir);
        }
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        notify_frontend(&window);
    }
}
