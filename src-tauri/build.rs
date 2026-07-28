fn main() {
    // Try tauri_build but don't fail on windres errors (dev builds only)
    if let Err(e) = tauri_build::try_build(tauri_build::Attributes::new()) {
        eprintln!("cargo:warning=tauri_build failed (non-fatal): {}", e);
    }
}
