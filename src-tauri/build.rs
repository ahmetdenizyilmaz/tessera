fn main() {
    // Tauri embeds the application manifest only in the main binary. The
    // isolated native window harness needs the same common-controls/DPI setup.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("examples/windows.manifest");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTINPUT:{}", manifest.display());
    }
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
