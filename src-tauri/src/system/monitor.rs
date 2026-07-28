use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

// Generation counter: every start bumps it and spawns a loop bound to the new
// generation; every stop bumps it without spawning. A loop exits as soon as
// the global generation no longer matches its own, so stop+start can never
// leave two loops running (unlike the old boolean flag, which raced against
// the loop's sleep).
static MONITOR_GEN: AtomicU64 = AtomicU64::new(0);

const DEFAULT_INTERVAL_MS: u64 = 3000;
const MIN_INTERVAL_MS: u64 = 250;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUpdatePayload {
    pub cpu_percent: f32,
    pub memory_used_gb: f64,
    pub memory_total_gb: f64,
    pub memory_percent: f32,
}

#[tauri::command]
pub async fn system_monitor_start(app: AppHandle, interval_ms: Option<u64>) -> Result<(), String> {
    // Claim a fresh generation; any previously running loop sees a stale
    // generation on its next check and exits.
    let my_gen = MONITOR_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let interval = interval_ms.unwrap_or(DEFAULT_INTERVAL_MS).max(MIN_INTERVAL_MS);

    // Use a tokio task since sysinfo is Send + we use sleep
    tokio::spawn(async move {
        let mut sys = System::new_all();

        // First refresh returns 0% for CPU - do it early and discard
        sys.refresh_cpu_all();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        while MONITOR_GEN.load(Ordering::SeqCst) == my_gen {
            sys.refresh_cpu_all();
            sys.refresh_memory();

            let cpu_percent = sys.global_cpu_usage();

            let memory_used = sys.used_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
            let memory_total = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
            let memory_percent = if memory_total > 0.0 {
                (memory_used / memory_total * 100.0) as f32
            } else {
                0.0
            };

            let payload = SystemUpdatePayload {
                cpu_percent,
                memory_used_gb: (memory_used * 100.0).round() / 100.0,
                memory_total_gb: (memory_total * 100.0).round() / 100.0,
                memory_percent,
            };

            let _ = app.emit("system-update", &payload);

            tokio::time::sleep(std::time::Duration::from_millis(interval)).await;
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn system_monitor_stop() -> Result<(), String> {
    // Invalidate the current generation so the running loop exits
    MONITOR_GEN.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
