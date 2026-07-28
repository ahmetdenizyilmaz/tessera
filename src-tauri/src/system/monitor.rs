use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use sysinfo::System;
use tauri::{AppHandle, Emitter};

static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUpdatePayload {
    pub cpu_percent: f32,
    pub memory_used_gb: f64,
    pub memory_total_gb: f64,
    pub memory_percent: f32,
}

#[tauri::command]
pub async fn system_monitor_start(app: AppHandle) -> Result<(), String> {
    // Atomically swap MONITOR_RUNNING to true and check the previous value.
    // If it was already true, another caller started the monitor first — the
    // `swap` guarantees exactly one caller sees `false` (the winner), so
    // concurrent calls are safe: the first caller proceeds, all others return
    // immediately. No additional locking is needed.
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(()); // already running
    }

    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    // Store the running flag so we can stop it
    // Use a tokio task since sysinfo is Send + we use sleep
    tokio::spawn(async move {
        let mut sys = System::new_all();

        // First refresh returns 0% for CPU - do it early and discard
        sys.refresh_cpu_all();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        while MONITOR_RUNNING.load(Ordering::SeqCst) {
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

            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        }

        drop(running_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn system_monitor_stop() -> Result<(), String> {
    MONITOR_RUNNING.store(false, Ordering::SeqCst);
    Ok(())
}
