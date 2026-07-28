use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::{Read, Write, stderr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::util::claude_paths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageInfo {
    pub session_cost: Option<f64>,
    pub session_percent: Option<f64>,
    pub weekly_percent: Option<f64>,
    pub raw_output: String,
}

fn strip_ansi(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            match chars.peek() {
                Some(&'[') => {
                    chars.next();
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if c.is_ascii_alphabetic() { break; }
                    }
                }
                Some(&']') => {
                    chars.next();
                    while let Some(&c) = chars.peek() {
                        chars.next();
                        if c == '\x07' { break; }
                        if c == '\x1b' {
                            if chars.peek() == Some(&'\\') { chars.next(); break; }
                        }
                    }
                }
                _ => { chars.next(); }
            }
        } else {
            result.push(ch);
        }
    }
    result
}

fn extract_percent(text: &str) -> Option<f64> {
    for (idx, _) in text.match_indices('%') {
        let before = &text[..idx];
        let num_str: String = before.chars().rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect::<String>().chars().rev().collect();
        if let Ok(val) = num_str.parse::<f64>() {
            if val >= 0.0 && val <= 100.0 { return Some(val); }
        }
    }
    None
}

fn parse_weekly_percent(raw: &str) -> Option<f64> {
    let text = strip_ansi(raw);

    for line in text.lines() {
        let ll = line.to_lowercase();
        if (ll.contains("week") || ll.contains("usage") || ll.contains("limit")) && ll.contains('%') {
            if let Some(pct) = extract_percent(line) {
                return Some(pct);
            }
        }
    }

    let lower = text.to_lowercase();
    if let Some(pos) = lower.find("week") {
        let start = pos.saturating_sub(80);
        let end = (pos + 80).min(text.len());
        if let Some(pct) = extract_percent(&text[start..end]) {
            return Some(pct);
        }
    }

    // Last resort: if only one percentage in output, that's probably it
    let all: Vec<f64> = text.match_indices('%').filter_map(|(idx, _)| {
        let before = &text[..idx];
        let num: String = before.chars().rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect::<String>().chars().rev().collect();
        num.parse::<f64>().ok().filter(|&v| v >= 0.0 && v <= 100.0)
    }).collect();

    if all.len() == 1 { Some(all[0]) } else { None }
}

/// Spawn a hidden Claude PTY, send /usage, parse result, then close.
pub fn check_usage_background() -> Result<ClaudeUsageInfo, String> {
    let claude_exe = claude_paths::find_claude_exe()
        .ok_or_else(|| "Could not find claude executable".to_string())?;

    let _ = writeln!(stderr(), "[usage_checker] Spawning Claude PTY...");

    let pty = native_pty_system();
    let pair = pty.openpty(PtySize { rows: 24, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("PTY open failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&claude_exe);
    cmd.arg("--dangerously-skip-permissions");
    cmd.arg("--model");
    cmd.arg("claude-sonnet-4-6");
    cmd.cwd(dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")));

    let _child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("Spawn failed: {e}"))?;
    drop(pair.slave);
    drop(_child);

    let mut writer = pair.master.take_writer()
        .map_err(|e| format!("Writer failed: {e}"))?;
    let mut reader = pair.master.try_clone_reader()
        .map_err(|e| format!("Reader failed: {e}"))?;

    let output = Arc::new(Mutex::new(String::new()));
    let output_ref = output.clone();
    let done = Arc::new(Mutex::new(false));
    let done_ref = done.clone();

    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            if *done_ref.lock().unwrap() { break; }
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    output_ref.lock().unwrap().push_str(&text);
                }
            }
        }
    });

    // Wait for the prompt (poll every 200ms)
    let start = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(200));
        let text = strip_ansi(&output.lock().unwrap());
        let ready = text.contains('\u{23F5}')    // play button
            || text.contains("bypass")
            || text.contains("esc to interrupt")
            || text.contains("shift+tab");
        if ready {
            let _ = writeln!(stderr(), "[usage_checker] Prompt detected, sending /usage...");
            break;
        }
        if start.elapsed() > Duration::from_secs(40) {
            let _ = writeln!(stderr(), "[usage_checker] Startup timeout");
            break;
        }
    }

    // Wait 1s after prompt detection so Claude Code fully initializes
    std::thread::sleep(Duration::from_millis(1000));

    let pre_len = output.lock().unwrap().len();
    let _ = writeln!(stderr(), "[usage_checker] Sending /usage (pre_len={})", pre_len);
    let _ = writer.write_all(b"/usage\r");
    let _ = writer.flush();

    // Wait for response to stabilise (no new bytes for 500ms)
    let t = Instant::now();
    let mut last_len = pre_len;
    let mut stable_ticks = 0u32;
    let mut got_new = false;

    loop {
        std::thread::sleep(Duration::from_millis(100));
        let cur_len = output.lock().unwrap().len();
        if cur_len > pre_len { got_new = true; }
        if got_new && cur_len == last_len {
            stable_ticks += 1;
            if stable_ticks >= 5 { break; } // 5 * 100ms = 500ms stable
        } else {
            stable_ticks = 0;
        }
        last_len = cur_len;
        if t.elapsed() > Duration::from_secs(15) { break; }
    }

    let full = output.lock().unwrap().clone();
    let usage_output = if full.len() > pre_len { full[pre_len..].to_string() } else { String::new() };

    let _ = writeln!(stderr(), "[usage_checker] Captured {} raw bytes, {} stripped bytes",
        usage_output.len(),
        strip_ansi(&usage_output).len()
    );
    let _ = writeln!(stderr(), "[usage_checker] Raw (stripped): {}", strip_ansi(&usage_output).replace('\r', "^R").replace('\n', " | "));

    // Close cleanly
    let _ = writer.write_all(b"/exit\r");
    let _ = writer.flush();
    std::thread::sleep(Duration::from_millis(300));
    *done.lock().unwrap() = true;
    drop(writer);
    drop(pair.master);
    let _ = reader_thread.join();

    let weekly_percent = parse_weekly_percent(&usage_output);
    let _ = writeln!(stderr(), "[usage_checker] weekly={:?}", weekly_percent);

    Ok(ClaudeUsageInfo {
        session_cost: None,
        session_percent: None,
        weekly_percent,
        raw_output: strip_ansi(&usage_output),
    })
}

#[tauri::command]
pub async fn check_claude_usage() -> Result<ClaudeUsageInfo, String> {
    tokio::task::spawn_blocking(|| check_usage_background())
        .await
        .map_err(|e| format!("Task failed: {e}"))?
}
