/// Kill a process and its entire child tree.
///
/// On Windows a plain `Child::kill()` on a shim (e.g. `claude.cmd` → cmd.exe)
/// kills only the shim and orphans the real node.exe process, so we use
/// `taskkill /T /F` to take the whole tree down.
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    {
        // Negative PID targets the process group where applicable; fall back
        // to a plain SIGKILL on the PID.
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}
