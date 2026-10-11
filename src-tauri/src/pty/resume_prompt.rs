//! Dismiss only Codex's paused-goal dialog during unattended terminal attach.
//! Escape leaves the goal unchanged. Any user input cancels this behavior.
use std::time::{Duration, Instant};

#[derive(Default)]
enum EscapeState {
    #[default]
    Text,
    Escape,
    Csi,
    Osc,
    OscEscape,
}

pub(super) struct ResumePrompt {
    started: Instant,
    state: EscapeState,
    text: String,
}

impl ResumePrompt {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            state: EscapeState::Text,
            text: String::new(),
        }
    }
    pub fn expired(&self) -> bool {
        self.started.elapsed() > Duration::from_secs(30)
    }

    pub fn observe(&mut self, output: &str) -> bool {
        if self.expired() {
            return false;
        }
        for byte in output.bytes() {
            self.state = match self.state {
                EscapeState::Text if byte == 0x1b => EscapeState::Escape,
                EscapeState::Text => {
                    if byte.is_ascii_graphic() {
                        self.text.push(byte.to_ascii_lowercase() as char);
                    }
                    EscapeState::Text
                }
                EscapeState::Escape if byte == b'[' => EscapeState::Csi,
                EscapeState::Escape if byte == b']' => EscapeState::Osc,
                EscapeState::Escape => EscapeState::Text,
                EscapeState::Csi if (0x40..=0x7e).contains(&byte) => EscapeState::Text,
                EscapeState::Csi => EscapeState::Csi,
                EscapeState::Osc if byte == 7 => EscapeState::Text,
                EscapeState::Osc if byte == 0x1b => EscapeState::OscEscape,
                EscapeState::Osc => EscapeState::Osc,
                EscapeState::OscEscape if byte == b'\\' => EscapeState::Text,
                EscapeState::OscEscape => EscapeState::Osc,
            };
        }
        if self.text.len() > 16384 {
            self.text.drain(..self.text.len() - 8192);
        }
        self.text.contains("resumepausedgoal?")
            && self.text.contains("markitactiveandcontinuewhenidle")
            && self.text.contains("keepitpaused;use/goalresumelater")
    }
}

/// Device/color reports and focus notifications are automatic terminal input.
/// Actual keys, mouse clicks and pasted text must always take priority.
pub(super) fn terminal_report(data: &str) -> bool {
    if matches!(data, "\x1b[I" | "\x1b[O") {
        return true;
    }
    if let Some(csi) = data.strip_prefix("\x1b[") {
        if let Some(last) = csi.as_bytes().last() {
            return matches!(last, b'c' | b'R' | b'n' | b't')
                && csi[..csi.len() - 1]
                    .bytes()
                    .all(|b| b.is_ascii_digit() || matches!(b, b';' | b'?' | b'>'));
        }
    }
    ["\x1b]10;rgb:", "\x1b]11;rgb:", "\x1b]12;rgb:"]
        .iter()
        .any(|prefix| {
            data.strip_prefix(prefix)
                .and_then(|v| v.strip_suffix('\x07').or_else(|| v.strip_suffix("\x1b\\")))
                .is_some_and(|v| v.bytes().all(|b| b.is_ascii_hexdigit() || b == b'/'))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_the_complete_startup_dialog_across_ansi_chunks() {
        let mut prompt = ResumePrompt::new();
        assert!(!prompt.observe("History mentioning Resume paused goal? alone"));
        assert!(!prompt.observe("\x1b[1;5HResume \x1b[1mpaused goal?\x1b[0m\r\n"));
        assert!(
            !prompt.observe("Mark it active and continue when idle\nKeep it paused; use /goal re")
        );
        assert!(prompt.observe("sume later\n"));
        let mut expired = ResumePrompt::new();
        expired.started -= Duration::from_secs(31);
        assert!(!expired.observe("Resume paused goal?Mark it active and continue when idleKeep it paused; use /goal resume later"));
    }

    #[test]
    fn distinguishes_terminal_reports_from_deliberate_input() {
        for report in [
            "\x1b[?1;2c",
            "\x1b[10;25R",
            "\x1b[>0;276;0c",
            "\x1b[I",
            "\x1b]11;rgb:0000/0000/0000\x07",
        ] {
            assert!(terminal_report(report), "{report:?}");
        }
        for key in [
            "\x1b",
            "\r",
            "\x1b[B",
            "\x1b[<0;25;10M",
            "hello",
            "\x1b[200~paste\x1b[201~",
        ] {
            assert!(!terminal_report(key), "{key:?}");
        }
    }
}
