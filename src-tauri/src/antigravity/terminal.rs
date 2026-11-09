use portable_pty::CommandBuilder;

/// The native TUI runs in xterm.js, even when Tessera was opened from Explorer
/// without a terminal environment. Keep this out of the headless JSON session.
pub(super) fn configure(command: &mut CommandBuilder) {
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{io::{Read, Write}, time::{Duration, Instant}};

    struct Fixture {
        child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
        root: std::path::PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Some(child) = &mut self.child {
                if let Some(pid) = child.process_id() { crate::util::proc::kill_tree(pid); }
                let _ = child.kill();
                let _ = child.wait();
            }
            // Only the unique test home, never the supplied authentication file.
            assert!(self.root.starts_with(std::env::temp_dir()));
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    #[ignore = "real agy required; isolated home; edits drafts only, no model turns"]
    fn live_antigravity_terminal_draft_redraw() {
        let executable = std::env::var("TESSERA_AGY_RENDER_TEST_EXE").expect("Set TESSERA_AGY_RENDER_TEST_EXE");
        let root = std::env::temp_dir().join(format!("tessera-agy-render-{}", uuid::Uuid::new_v4()));
        let mut fixture = Fixture { child: None, root: root.clone() };
        let home = root.join("home");
        let cwd = root.join("project");
        let config = home.join(".gemini/antigravity-cli");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&cwd).unwrap();
        if let Some(auth) = std::env::var_os("TESSERA_AGY_RENDER_AUTH_FILE") {
            std::fs::copy(auth, config.join("antigravity-oauth-token")).unwrap();
        }
        std::fs::write(config.join("settings.json"), serde_json::to_vec(&serde_json::json!({
            "trustedWorkspaces": [cwd], "enableTerminalAnimations": true,
            "onboardingComplete": true, "colorScheme": "dark"
        })).unwrap()).unwrap();
        let size = |cols, rows| portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
        let pair = portable_pty::native_pty_system().openpty(size(100, 30)).unwrap();
        // A private executable as well as a private home keeps any CLI updater
        // from replacing the installed binary used by the user's panels.
        let private_executable = root.join("agy.exe");
        std::fs::copy(executable, &private_executable).unwrap();
        let mut command = CommandBuilder::new(private_executable);
        command.cwd(&cwd);
        command.env("HOME", &home);
        command.env("USERPROFILE", &home);
        command.env("APPDATA", home.join("AppData/Roaming"));
        command.env("LOCALAPPDATA", home.join("AppData/Local"));
        // agy accepts the literal "true" here; "1" does not disable updates.
        command.env("AGY_CLI_DISABLE_AUTO_UPDATE", "true");
        // No inherited panel bridge or nested-session identity in this fixture.
        for key in ["TESSERA_PANEL_BUS_URL", "TESSERA_PANEL_BUS_TOKEN", "CODEX_THREAD_ID", "CLAUDECODE"] {
            command.env_remove(key);
        }
        if std::env::var_os("TESSERA_AGY_RENDER_BASELINE").is_none() {
            configure(&mut command);
        } else {
            for key in ["TERM", "COLORTERM", "AGY_CLI_DISABLE_ESCAPE_SEQUENCE_OPTIMIZATIONS"] {
                command.env_remove(key);
            }
        }
        fixture.child = Some(pair.slave.spawn_command(command).unwrap());
        drop(pair.slave);
        let mut input = pair.master.take_writer().unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut bytes = [0; 16384];
            while let Ok(n) = reader.read(&mut bytes) {
                if n == 0 || tx.send(bytes[..n].to_vec()).is_err() { break; }
            }
        });
        if std::env::var_os("TESSERA_AGY_RENDER_EARLY_INPUT").is_some() {
            input.write_all(b"a").unwrap(); input.flush().unwrap();
        }
        let mut parser = vt100::Parser::new(30, 100, 0);
        let mut events = Vec::new();
        let mut query_tail = String::new();
        let pump = |parser: &mut vt100::Parser, input: &mut Box<dyn Write + Send>, events: &mut Vec<serde_json::Value>, query_tail: &mut String, ms| {
            let deadline = Instant::now() + Duration::from_millis(ms);
            while Instant::now() < deadline {
                if let Ok(bytes) = rx.recv_timeout(Duration::from_millis(40)) {
                    parser.process(&bytes);
                    events.push(serde_json::json!({"data": bytes}));
                    query_tail.push_str(&String::from_utf8_lossy(&bytes));
                    if query_tail.contains("\x1b[6n") {
                        let (row, col) = parser.screen().cursor_position();
                        write!(input, "\x1b[{};{}R", row + 1, col + 1).unwrap();
                    }
                    if query_tail.contains("\x1b[c") { input.write_all(b"\x1b[?1;2c").unwrap(); }
                    if query_tail.contains("\x1b]11;?") { input.write_all(b"\x1b]11;rgb:1111/1111/1b1b\x1b\\").unwrap(); }
                    input.flush().unwrap();
                    // Queries may straddle ConPTY reads, but never answer a completed query twice.
                    let last = query_tail.rfind('\x1b').unwrap_or(query_tail.len());
                    let tail = &query_tail[last..];
                    *query_tail = if tail.len() < 4 { tail.to_string() } else { String::new() };
                }
            }
        };
        pump(&mut parser, &mut input, &mut events, &mut query_tail, 10000);
        let prompt = |parser: &vt100::Parser| parser.screen().contents().lines()
            .rev().find(|line| line.trim_start().starts_with('>')).map(str::trim_end).map(str::to_string);
        if std::env::var_os("TESSERA_AGY_RENDER_EARLY_INPUT").is_some() {
            input.write_all(b"\x7f").unwrap(); input.flush().unwrap();
            pump(&mut parser, &mut input, &mut events, &mut query_tail, 500);
        }
        let empty_prompt = prompt(&parser).expect("CLI did not reach its empty draft");
        assert!(!parser.screen().contents().contains("Welcome to Antigravity CLI!"), "CLI still in onboarding");
        assert_eq!(empty_prompt.trim(), ">", "startup left a stray character at the prompt");
        events.push(serde_json::json!({"checkpoint": "startup", "prompt": empty_prompt}));
        for (label, draft) in [("one character", "a"), ("ordinary text", "tessera redraw test"), ("wrapped text", &"resize draft ".repeat(14))] {
            input.write_all(draft.as_bytes()).unwrap(); input.flush().unwrap();
            pump(&mut parser, &mut input, &mut events, &mut query_tail, 400);
            assert!(parser.screen().contents().contains(draft.split_whitespace().next().unwrap()), "typed text missing: {label}");
            input.write_all(&vec![0x7f; draft.len()]).unwrap(); input.flush().unwrap();
            pump(&mut parser, &mut input, &mut events, &mut query_tail, 500);
            assert_eq!(prompt(&parser).as_ref(), Some(&empty_prompt), "empty draft not restored: {label}");
            events.push(serde_json::json!({"checkpoint": label, "prompt": empty_prompt}));
        }
        for (cols, rows) in [(40, 16), (130, 38), (80, 24)] {
            input.write_all(b"a").unwrap(); input.flush().unwrap();
            pump(&mut parser, &mut input, &mut events, &mut query_tail, 150);
            parser.screen_mut().set_size(rows, cols);
            events.push(serde_json::json!({"resize": [cols, rows]}));
            pair.master.resize(size(cols, rows)).unwrap();
            pump(&mut parser, &mut input, &mut events, &mut query_tail, 400);
            input.write_all(b"\x7f").unwrap(); input.flush().unwrap();
            pump(&mut parser, &mut input, &mut events, &mut query_tail, 500);
            let expected: String = empty_prompt.chars().take(cols as usize).collect();
            assert_eq!(prompt(&parser).as_ref(), Some(&expected), "draft not cleared after resize to {cols}x{rows}");
            events.push(serde_json::json!({"checkpoint": format!("resize {cols}x{rows}"), "prompt": expected}));
        }
        eprintln!("PASS real agy: startup, first-character deletion, ordinary/wrapped drafts, three resizes ({} output bytes)",
            events.iter().filter_map(|e| e["data"].as_array()).map(Vec::len).sum::<usize>());
        if let Some(capture) = std::env::var_os("TESSERA_AGY_RENDER_CAPTURE") {
            std::fs::write(capture, serde_json::to_vec(&events).unwrap()).unwrap();
        }
    }
}
