//! Dismiss only Codex's paused-goal dialog during unattended terminal attach.
//! Escape leaves the goal unchanged. Any user input cancels this behavior.
use std::time::{Duration, Instant};

pub(super) struct ResumePrompt {
    started: Instant,
    terminal: vt100::Parser,
}

impl ResumePrompt {
    pub fn new(cols: u16, rows: u16) -> Option<Self> {
        // This temporary screen has no scrollback and is released as soon as
        // the dialog closes or the user types. Bound unusual terminal sizes.
        Self::valid_size(cols, rows).then(|| Self {
            started: Instant::now(),
            terminal: vt100::Parser::new(rows, cols, 0),
        })
    }
    fn valid_size(cols: u16, rows: u16) -> bool {
        cols >= 2 && rows > 0 && u32::from(cols) * u32::from(rows) <= 250_000
    }
    pub fn resize(&mut self, cols: u16, rows: u16) -> bool {
        if !Self::valid_size(cols, rows) { return false; }
        self.terminal.screen_mut().set_size(rows, cols);
        true
    }
    pub fn expired(&self) -> bool {
        // Small/hidden panels may not paint the whole dialog until layout has
        // settled. User input still disarms the watcher immediately.
        self.started.elapsed() > Duration::from_secs(120)
    }

    pub fn observe(&mut self, output: &str) -> bool {
        if self.expired() {
            return false;
        }
        // ConPTY skips unchanged cells when painting a dialog over history.
        // Concatenating output chunks can therefore miss arbitrary letters.
        self.terminal.process(output.as_bytes());
        self.visible()
    }

    pub fn visible(&self) -> bool {
        let text: String = self.terminal.screen().contents().bytes()
            .filter(u8::is_ascii_graphic).map(|b| b.to_ascii_lowercase() as char).collect();
        // Ratatui omits the descriptions entirely in narrow panels. Match the
        // visible title, both numbered choices and footer on the same screen.
        ["resumepausedgoal?", "1.resumegoal", "2.leavepaused", "enterselect", "escback"]
            .iter().all(|part| text.contains(part))
    }
}

/// Device/color reports and focus notifications are automatic terminal input.
/// Actual keys, mouse clicks and pasted text must always take priority.
pub(super) fn terminal_report(data: &str) -> bool {
    let mut rest = data;
    while !rest.is_empty() {
        if rest.starts_with("\x1b[I") || rest.starts_with("\x1b[O") {
            rest = &rest[3..];
            continue;
        }
        if let Some(csi) = rest.strip_prefix("\x1b[") {
            let Some(end) = csi.bytes().position(|b| (0x40..=0x7e).contains(&b)) else { return false };
            if !matches!(csi.as_bytes()[end], b'c' | b'R' | b'n' | b't')
                || !csi[..end].bytes().all(|b| b.is_ascii_digit() || matches!(b, b';' | b'?' | b'>'))
            { return false; }
            rest = &csi[end + 1..];
            continue;
        }
        let Some(color) = ["\x1b]10;rgb:", "\x1b]11;rgb:", "\x1b]12;rgb:"]
            .iter().find_map(|prefix| rest.strip_prefix(prefix)) else { return false };
        let Some(end) = color.bytes().position(|b| b == 7 || b == 0x1b) else { return false };
        if !color[..end].bytes().all(|b| b.is_ascii_hexdigit() || b == b'/') { return false; }
        let tail = &color[end..];
        let Some(next) = tail.strip_prefix('\x07').or_else(|| tail.strip_prefix("\x1b\\")) else { return false };
        rest = next;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_the_complete_startup_dialog_across_ansi_chunks() {
        let mut prompt = ResumePrompt::new(38, 16).unwrap();
        assert!(!prompt.observe("History mentioning Resume paused goal? alone"));
        assert!(!prompt.observe("\x1b[2J\x1b[1;1HResume \x1b[1mpaused goal?\x1b[0m\r\n"));
        assert!(!prompt.observe("1. Resume goal\r\n2. Leave paused\r\nenter select"));
        assert!(!prompt.observe("\x1b[6;4Hesc ba"));
        assert!(prompt.observe("ck\n"));
        let mut expired = ResumePrompt::new(120, 32).unwrap();
        expired.started -= Duration::from_secs(121);
        assert!(!expired.observe("Resume paused goal?1. Resume goal2. Leave pausedenter selectesc back"));
    }

    #[test]
    fn recognizes_partial_repaints_and_resize_without_matching_erased_history() {
        let mut prompt = ResumePrompt::new(38, 16).unwrap();
        prompt.started -= Duration::from_secs(45);
        // The e in 'paused' is already on the screen; Windows skips it.
        assert!(!prompt.observe("\x1b[1;12He\x1b[1;1HResume paus\x1b[1;13Hd goal?"));
        assert!(!prompt.observe("\x1b[3;1H1. Resume goal\x1b[4;1H2. Leave paused"));
        assert!(prompt.observe("\x1b[6;1Henter select · esc back"));
        assert!(prompt.resize(44, 14));
        assert!(!prompt.observe("\x1b[2J\x1b[1;1H1. Resume goal\r\n2. Leave paused\r\nenter select · esc back"));
        assert!(prompt.observe("\x1b[6;1HResume paused goal?"));
        assert!(!prompt.resize(u16::MAX, u16::MAX));
        assert!(ResumePrompt::new(0, 0).is_none());
    }

    #[test]
    fn distinguishes_terminal_reports_from_deliberate_input() {
        for report in [
            "\x1b[?1;2c",
            "\x1b[10;25R",
            "\x1b[>0;276;0c",
            "\x1b[I",
            "\x1b]11;rgb:0000/0000/0000\x07",
            "\x1b[I\x1b[?1;2c\x1b]11;rgb:1111/1111/1b1b\x1b\\\x1b[1;1R",
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
            "\x1b[?1;2c\r",
            "\x1b[O\x1b[B",
        ] {
            assert!(!terminal_report(key), "{key:?}");
        }
    }
}
