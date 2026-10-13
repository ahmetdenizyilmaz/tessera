use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const PASTE_SETTLE: Duration = Duration::from_millis(500);
const RESUME_DIALOG_SETTLE: Duration = Duration::from_millis(500);

struct Writer {
    stream: Option<Box<dyn Write + Send>>,
    revision: u64,
    resume_prompt: Option<super::resume_prompt::ResumePrompt>,
    dismiss_pending: bool,
}

/// One handle per PTY lifetime: a delayed Enter can never reach a replacement
/// process, and simultaneous panel messages cannot interleave their input.
pub(crate) struct TerminalInput {
    session: String,
    writer: Mutex<Writer>,
    messages: tokio::sync::Mutex<()>,
}

impl TerminalInput {
    pub fn new(stream: Box<dyn Write + Send>) -> Self {
        Self::with_prompt(stream, None)
    }

    pub fn with_quiet_goal_resume(stream: Box<dyn Write + Send>, cols: u16, rows: u16) -> Self {
        Self::with_prompt(stream, super::resume_prompt::ResumePrompt::new(cols, rows))
    }

    fn with_prompt(stream: Box<dyn Write + Send>, resume_prompt: Option<super::resume_prompt::ResumePrompt>) -> Self {
        Self {
            session: uuid::Uuid::new_v4().to_string(),
            writer: Mutex::new(Writer { stream: Some(stream), revision: 0,
                resume_prompt, dismiss_pending: false }),
            messages: tokio::sync::Mutex::new(()),
        }
    }

    pub fn resize_prompt(&self, cols: u16, rows: u16) {
        let Ok(mut writer) = self.writer.lock() else { return };
        if writer.resume_prompt.as_mut().is_some_and(|prompt| !prompt.resize(cols, rows)) {
            writer.resume_prompt = None;
        }
    }

    pub fn observe_output(self: &Arc<Self>, output: &str) {
        let Ok(mut writer) = self.writer.lock() else { return };
        if writer.resume_prompt.as_ref().is_some_and(|prompt| prompt.expired()) {
            writer.resume_prompt = None;
        }
        let visible = writer.resume_prompt.as_mut().is_some_and(|prompt| prompt.observe(output));
        if visible && !writer.dismiss_pending {
            writer.dismiss_pending = true;
            drop(writer);
            // Codex can paint the popup before its startup input queries have
            // finished. Let them settle without blocking the PTY reader, then
            // recheck the screen and user-input guard under the same lock.
            let input = self.clone();
            std::thread::spawn(move || {
                std::thread::sleep(RESUME_DIALOG_SETTLE);
                let Ok(mut writer) = input.writer.lock() else { return };
                writer.dismiss_pending = false;
                if writer.resume_prompt.as_ref().is_some_and(|prompt| !prompt.expired() && prompt.visible()) {
                    writer.resume_prompt = None;
                    if let Some(stream) = writer.stream.as_mut() {
                        let _ = stream.write_all(b"\x1b").and_then(|_| stream.flush());
                    }
                }
            });
        }
    }

    pub fn close(&self) {
        if let Ok(mut writer) = self.writer.lock() {
            writer.stream = None;
            writer.resume_prompt = None;
        }
    }

    pub fn session(&self) -> Option<String> {
        self.writer.lock().ok()?.stream.as_ref()?;
        Some(self.session.clone())
    }

    pub fn write_for_session(&self, session: &str, data: &str) -> Result<(), String> {
        if session != self.session {
            return Err("The host terminal restarted. Refresh its screen before typing again.".into());
        }
        self.write(data)
    }

    fn write_checked(&self, data: &str, expected: Option<u64>) -> Result<u64, String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        if expected.is_some_and(|revision| revision != writer.revision) {
            return Err("The terminal input changed during delivery. The message was pasted but not submitted; do not resend it automatically.".into());
        }
        if !super::resume_prompt::terminal_report(data) { writer.resume_prompt = None; }
        writer.revision = writer.revision.wrapping_add(1);
        let stream = writer.stream.as_mut()
            .ok_or("That panel's terminal is no longer accepting input")?;
        stream.write_all(data.as_bytes()).map_err(|e| format!("Write failed: {e}"))?;
        stream.flush().map_err(|e| format!("Flush failed: {e}"))?;
        Ok(writer.revision)
    }

    pub fn write(&self, data: &str) -> Result<(), String> {
        self.write_checked(data, None).map(|_| ())
    }

    pub async fn submit(&self, text: &str) -> Result<(), String> {
        // Messages are text, not terminal keystrokes. In particular, an ESC in
        // the payload must not end bracketed paste or trigger a TUI shortcut.
        if text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) {
            return Err("Panel messages cannot contain terminal control characters".into());
        }
        let text = text.replace("\r\n", "\n").replace('\r', "\n");
        let _message = self.messages.lock().await;
        let revision = self.write_checked(&format!("\x1b[200~{text}\x1b[201~"), None)?;
        // A CR in the same input burst is treated as pasted text by Claude.
        // Flush the complete paste, let the TUI process it, then press Enter.
        tokio::time::sleep(PASTE_SETTLE).await;
        self.write_checked("\r", Some(revision)).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::sync::Arc;
    use std::time::Instant;

    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<(Instant, Vec<u8>)>>>);
    impl Write for Capture {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().push((Instant::now(), bytes.to_vec()));
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> { Ok(()) }
    }

    #[test]
    fn paused_goal_dismissal_is_once_only_and_never_overrides_user_input() {
        let dialog = "Resume paused goal? 1. Resume goal 2. Leave paused enter select · esc back";
        let capture = Capture::default();
        let input = Arc::new(TerminalInput::with_quiet_goal_resume(Box::new(capture.clone()), 120, 32));
        input.write("\x1b[?1;2c").unwrap();
        input.observe_output(dialog);
        input.observe_output(dialog);
        std::thread::sleep(RESUME_DIALOG_SETTLE + Duration::from_millis(100));
        assert_eq!(capture.0.lock().unwrap().iter().map(|(_, bytes)| bytes.clone()).collect::<Vec<_>>(),
            vec![b"\x1b[?1;2c".to_vec(), b"\x1b".to_vec()]);
        for key in ["hello", "\x1b[B", "\r", "\x1b"] {
            let capture = Capture::default();
            let input = Arc::new(TerminalInput::with_quiet_goal_resume(Box::new(capture.clone()), 120, 32));
            input.write(key).unwrap();
            input.observe_output(dialog);
            assert_eq!(capture.0.lock().unwrap().len(), 1);
        }
        let capture = Capture::default();
        let input = Arc::new(TerminalInput::new(Box::new(capture.clone())));
        input.observe_output(dialog);
        assert!(capture.0.lock().unwrap().is_empty());
    }

    #[test]
    fn typing_closing_or_dismissing_during_settle_cancels_automatic_escape() {
        let captures: Vec<_> = (0..3).map(|_| Capture::default()).collect();
        for (i, capture) in captures.iter().enumerate() {
            let input = Arc::new(TerminalInput::with_quiet_goal_resume(Box::new(capture.clone()), 120, 32));
            input.observe_output("Resume paused goal? 1. Resume goal 2. Leave paused enter select · esc back");
            match i {
                0 => input.write("typing").unwrap(),
                1 => input.close(),
                _ => input.observe_output("\x1b[2J\x1b[HAsk Codex to do anything"),
            }
        }
        std::thread::sleep(RESUME_DIALOG_SETTLE + Duration::from_millis(100));
        assert_eq!(captures[0].0.lock().unwrap().iter().map(|(_, bytes)| bytes.clone()).collect::<Vec<_>>(), vec![b"typing".to_vec()]);
        assert!(captures[1].0.lock().unwrap().is_empty());
        assert!(captures[2].0.lock().unwrap().is_empty());
    }

    #[test]
    fn remote_keys_are_exact_and_bound_to_a_single_live_session() {
        let capture = Capture::default();
        let input = TerminalInput::new(Box::new(capture.clone()));
        let session = input.session().unwrap();
        let data = "Ünye\x1b[A\t\x03\r";
        input.write_for_session(&session, data).unwrap();
        let replacement = TerminalInput::new(Box::new(capture.clone()));
        assert!(replacement.write_for_session(&session, "stale\r").is_err());
        input.close();
        assert!(input.session().is_none());
        assert!(input.write_for_session(&session, "closed\r").is_err());
        assert_eq!(capture.0.lock().unwrap()[0].1, data.as_bytes());
        assert_eq!(capture.0.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn paste_preserves_multiline_unicode_and_enter_is_separate() {
        let capture = Capture::default();
        let input = TerminalInput::new(Box::new(capture.clone()));
        input.submit("Ünye\r\n  code\tline\nDone").await.unwrap();
        let writes = capture.0.lock().unwrap();
        assert_eq!(writes.len(), 2);
        assert_eq!(writes[0].1, "\x1b[200~Ünye\n  code\tline\nDone\x1b[201~".as_bytes());
        assert_eq!(writes[1].1, b"\r");
        assert!(writes[1].0.duration_since(writes[0].0) >= PASTE_SETTLE);
    }

    #[tokio::test]
    async fn simultaneous_messages_do_not_merge() {
        let capture = Capture::default();
        let input = TerminalInput::new(Box::new(capture.clone()));
        let (a, b) = tokio::join!(input.submit("first"), input.submit("second"));
        a.unwrap(); b.unwrap();
        let writes = capture.0.lock().unwrap();
        assert_eq!(writes.iter().map(|(_, bytes)| bytes.as_slice()).collect::<Vec<_>>(),
            vec![b"\x1b[200~first\x1b[201~".as_slice(), b"\r", b"\x1b[200~second\x1b[201~", b"\r"]);
    }

    #[tokio::test]
    async fn closing_a_terminal_cancels_its_delayed_enter() {
        let capture = Capture::default();
        let input = TerminalInput::new(Box::new(capture.clone()));
        let (result, ()) = tokio::join!(input.submit("message"), async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            input.close();
        });
        assert!(result.is_err());
        assert_eq!(capture.0.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn user_edit_during_paste_is_not_auto_submitted() {
        let capture = Capture::default();
        let input = TerminalInput::new(Box::new(capture.clone()));
        let (result, ()) = tokio::join!(input.submit("message"), async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            input.write("editing").unwrap();
        });
        assert!(result.unwrap_err().contains("not submitted"));
        assert_eq!(capture.0.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn control_sequences_and_failed_pastes_never_send_enter() {
        let capture = Capture::default();
        let input = TerminalInput::new(Box::new(capture.clone()));
        assert!(input.submit("text\x1b[201~\r").await.is_err());
        assert!(capture.0.lock().unwrap().is_empty());
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> { Err(io::ErrorKind::BrokenPipe.into()) }
            fn flush(&mut self) -> io::Result<()> { panic!("failed paste must not flush or submit") }
        }
        assert!(TerminalInput::new(Box::new(Broken)).submit("message").await.is_err());
    }
}
