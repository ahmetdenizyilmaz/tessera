// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A CLI started this executable as a stdio MCP server for one of our panels.
    // Never open the app (or wake the running one) for that.
    if std::env::args().any(|arg| arg == tessera_lib::panelbus::bridge::FLAG) {
        std::process::exit(tessera_lib::panelbus::bridge::run());
    }
    tessera_lib::run();
}
