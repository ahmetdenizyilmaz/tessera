use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

const PASTE_SETTLE: Duration = Duration::from_millis(500);

struct Writer {
    stream: Option<Box<dyn Write + Send>>,
    revision: u64,
}

/// One handle per PTY lifetime: a delayed Enter can never reach a replacement
/// process, and simultaneous panel messages cannot interleave their input.
pub(super) struct TerminalInput {
    writer: Mutex<Writer>,
    messages: tokio::sync::Mutex<()>,
}

impl TerminalInput {
    pub fn new(stream: Box<dyn Write + Send>) -> Self {
        Self {
            writer: Mutex::new(Writer { stream: Some(stream), revision: 0 }),
            messages: tokio::sync::Mutex::new(()),
        }
    }

    pub fn close(&self) {
        if let Ok(mut writer) = self.writer.lock() {
            writer.stream = None;
        }
    }

    fn write_checked(&self, data: &str, expected: Option<u64>) -> Result<u64, String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        if expected.is_some_and(|revision| revision != writer.revision) {
            return Err("The terminal input changed during delivery. The message was pasted but not submitted; do not resend it automatically.".into());
        }
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
