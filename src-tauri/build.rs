fn main() {
    // Tolerate tauri_build failures in dev builds — a missing windres must
    // not block cargo check/test. In release the embedded resources are not
    // optional: an exe without its manifest pulls in comctl32 v5 and dies at
    // launch with "TaskDialogIndirect entry point not found", so fail loudly
    // instead of shipping that.
    if let Err(e) = tauri_build::try_build(tauri_build::Attributes::new()) {
        if std::env::var("PROFILE").as_deref() == Ok("release") {
            panic!("tauri_build failed: {e}");
        }
        eprintln!("cargo:warning=tauri_build failed (non-fatal): {}", e);
    }
}
