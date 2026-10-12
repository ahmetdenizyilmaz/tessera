//! Synthetic office renderer only. Separate profile; no user databases or agents.
fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.tessera.office-validation".into();
    let window = &mut context.config_mut().app.windows[0];
    window.url = tauri::WebviewUrl::External("http://localhost:1420/tools/office-fixture.html".parse().unwrap());
    window.title = "Tessera office validation (synthetic)".into();
    window.width = 1500.0;
    window.height = 1000.0;
    window.visible = false;
    window.maximized = false;
    window.create = true;
    tauri::Builder::default()
        .setup(|app| {
            // A failed test cannot leave an orphan native window behind.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(180));
                handle.exit(0);
            });
            Ok(())
        })
        .run(context).expect("office validation");
}
