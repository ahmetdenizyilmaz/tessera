pub mod agents;
pub mod analytics;
pub mod app_paths;
pub mod auth;
pub mod checkpoints;
pub mod codex;
pub mod opencode;
pub mod computer;
pub mod db;
pub mod lan;
pub mod launch;
pub mod llm;
pub mod mcp;
pub mod panelbus;
pub mod pty;
pub mod relay;
pub mod sessions;
pub mod stream;
pub mod system;
pub mod util;
pub mod ws;

use analytics::posthog::PostHogTracker;
use db::Database;
use pty::manager::PtyManager;
use relay::client::RelayClient;
use stream::manager::StreamJsonManager;

pub fn run() {
    let database = Database::new().expect("Failed to initialize database");
    let lan_manager = lan::LanManager::new().expect("Failed to initialize LAN identity");

    tauri::Builder::default()
        // Single instance MUST be the first plugin. A second `cgui` launch
        // forwards its argv here and exits; we queue its directory + focus.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            launch::on_second_instance(app, argv);
        }))
        .manage(launch::LaunchQueue::default())
        .manage(lan_manager)
        .manage(lan::terminal::TerminalRequests::default())
        .setup(|app| {
            // First launch: `cgui <dir>` passes the directory in our own argv.
            if let Some(dir) = launch::dir_from_argv(&std::env::args().collect::<Vec<_>>()) {
                app.state::<launch::LaunchQueue>().push(dir);
            }
            // Failsafe: the main window starts hidden and the frontend shows
            // it once painted. If the frontend crashes before that, reveal
            // the window anyway so the app isn't invisibly stuck.
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }

            // Panel bus. Bind SYNCHRONOUSLY here: the port has to be known
            // before the first `stream_configure`, and setup() runs before any
            // command can execute. Never rebind — sessions already spawned
            // hold the old port in their MCP config file.
            let token =
                format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4()).replace('-', "");
            let bound = tauri::async_runtime::block_on(async {
                tokio::net::TcpListener::bind(("127.0.0.1", 0)).await
            });
            let port = match bound {
                Ok(listener) => {
                    let port = listener.local_addr().ok().map(|a| a.port());
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(panelbus::server::serve(listener, handle));
                    if let Some(p) = port {
                        eprintln!("[panelbus] listening on 127.0.0.1:{}", p);
                        // Opt-in: prints the bearer token so the endpoint can be
                        // exercised with the MCP inspector or curl. Off by
                        // default — the token is a live credential for this
                        // window's panels.
                        if std::env::var("CLAUDE_GUI_PANELBUS_DEBUG").is_ok() {
                            eprintln!("[panelbus] debug token: {}", token);
                        }
                    }
                    port
                }
                Err(e) => {
                    // Degrade, never panic: panel messaging goes dark, the app
                    // still starts.
                    eprintln!(
                        "[panelbus] could not bind loopback port: {} — panel messaging disabled",
                        e
                    );
                    None
                }
            };
            app.manage(panelbus::PanelBus::new(port, token));

            // Skill + slash commands handed to every session via --plugin-dir.
            if panelbus::plugin::ensure_installed().is_none() {
                eprintln!("[panelbus] plugin not installed — sessions will spawn without it");
            }

            app.state::<lan::LanManager>()
                .initialize(app.handle().clone());

            Ok(())
        })
        .manage(PtyManager::new())
        .manage(RelayClient::new())
        .manage(StreamJsonManager::new())
        .manage(codex::CodexManager::default())
        .manage(opencode::OpenCodeManager::default())
        .manage(database)
        .manage(llm::manager::LlmManager::new())
        .manage(PostHogTracker::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .register_uri_scheme_protocol("screenshot", |_ctx, request| {
            computer::handle_screenshot_protocol(request)
        })
        .invoke_handler(tauri::generate_handler![
            // Codex commands
            codex::codex_discover,
            opencode::opencode_discover,
            opencode::opencode_models,
            opencode::opencode_configure,
            opencode::opencode_snapshot,
            opencode::opencode_send,
            opencode::opencode_seed,
            opencode::opencode_interrupt,
            opencode::opencode_respond,
            opencode::opencode_close,
            opencode::opencode_terminal_spawn,
            codex::codex_history,
            codex::codex_read_thread,
            codex::codex_configure,
            codex::codex_send,
            codex::codex_interrupt,
            codex::codex_respond,
            codex::codex_close,
            codex::codex_terminal_spawn,
            // PTY commands
            pty::manager::pty_capabilities,
            pty::manager::pty_spawn,
            pty::manager::pty_write,
            pty::manager::pty_submit,
            pty::manager::pty_resize,
            pty::manager::pty_kill,
            pty::manager::pty_get_buffer,
            pty::manager::pty_list_instances,
            pty::manager::pty_query_command,
            // Session commands
            sessions::scanner::session_scan_all,
            sessions::scanner::session_list_recent,
            sessions::scanner::session_debug_history,
            sessions::scanner::session_exists,
            sessions::history_loader::session_load_history,
            sessions::fork_writer::session_write_fork,
            sessions::fork_writer::codex_write_fork_thread,
            sessions::usage_parser::session_parse_usage,
            sessions::usage_parser::session_parse_recent_usage,
            sessions::usage_checker::check_claude_usage,
            sessions::image_saver::save_chat_image,
            sessions::image_saver::read_chat_image,
            sessions::file_manager::session_save_ady,
            sessions::file_manager::session_load_ady,
            // System commands
            system::monitor::system_monitor_start,
            system::monitor::system_monitor_stop,
            // Auth commands
            auth::keyring_store::get_access_token,
            auth::keyring_store::get_server_url,
            auth::login::auth_login,
            auth::login::auth_register,
            auth::login::auth_logout,
            auth::login::auth_check,
            auth::device::get_device_id,
            auth::device::register_device,
            // Relay commands
            relay::client::relay_connect,
            relay::client::relay_disconnect,
            relay::client::relay_status,
            relay::client::relay_send_instances,
            relay::client::relay_get_instance_count,
            // Direct encrypted local-network peers
            lan::lan_status,
            lan::lan_set_sharing,
            lan::lan_set_name,
            lan::lan_request_pair,
            lan::lan_respond_pair_request,
            lan::lan_connect,
            lan::lan_disconnect,
            lan::lan_forget,
            lan::lan_send_panel,
            lan::lan_read_panel,
            lan::lan_read_terminal,
            lan::terminal::lan_terminal_snapshot_result,
            // Computer commands
            computer::computer_screenshot,
            computer::computer_mouse_move,
            computer::computer_mouse_click,
            computer::computer_key_type,
            // Stream-JSON commands
            stream::manager::stream_configure,
            stream::manager::stream_send_message,
            stream::manager::stream_control_response,
            stream::manager::stream_control_request,
            stream::manager::stream_clear,
            stream::manager::stream_kill,
            stream::manager::stream_set_model,
            stream::manager::stream_set_thinking,
            // MCP commands
            mcp::config::mcp_list_servers,
            mcp::config::mcp_check_status,
            mcp::config::mcp_add_server,
            mcp::config::mcp_update_server,
            mcp::config::mcp_remove_server,
            mcp::config::mcp_toggle_server,
            mcp::config::mcp_import_from_claude_desktop,
            // Agent commands
            agents::manager::agent_list,
            agents::manager::agent_create,
            agents::manager::agent_update,
            agents::manager::agent_delete,
            agents::manager::agent_list_runs,
            // Checkpoint commands
            checkpoints::manager::checkpoint_create,
            checkpoints::manager::checkpoint_list,
            checkpoints::manager::checkpoint_get,
            checkpoints::manager::checkpoint_restore,
            checkpoints::manager::checkpoint_diff,
            checkpoints::manager::checkpoint_delete,
            checkpoints::manager::checkpoint_branch,
            checkpoints::manager::checkpoint_gc,
            // Checkpoint strategy commands
            checkpoints::strategy::checkpoint_should_trigger,
            checkpoints::strategy::checkpoint_set_strategy,
            checkpoints::strategy::checkpoint_get_strategy,
            // Analytics commands
            analytics::tracker::analytics_record,
            analytics::tracker::analytics_summary,
            analytics::tracker::analytics_export_csv,
            analytics::tracker::analytics_by_project,
            analytics::tracker::analytics_by_session,
            analytics::tracker::analytics_timeseries,
            analytics::tracker::analytics_model_pricing,
            // LLM commands
            llm::manager::llm_create_session,
            llm::manager::llm_send_message,
            llm::manager::llm_cancel,
            llm::manager::llm_destroy_session,
            llm::manager::llm_list_models,
            llm::manager::llm_check_connection,
            llm::ollama::ollama_import_gguf,
            llm::keystore::llm_get_api_key,
            llm::keystore::llm_set_api_key,
            llm::keystore::llm_delete_api_key,
            // CLI launcher (cgui)
            launch::take_launch_dirs,
            // Panel bus (cross-panel messaging)
            panelbus::panel_registry_sync,
            panelbus::panel_bus_set_enabled,
            panelbus::panel_bus_status,
            // File listing
            util::file_listing::list_project_files,
            // Slash commands
            util::slash_commands::list_slash_commands,
            // PostHog
            analytics::posthog::posthog_init,
            analytics::posthog::posthog_track,
            analytics::posthog::posthog_flush,
            analytics::posthog::posthog_set_enabled,
            analytics::posthog::posthog_is_enabled,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Kill every spawned claude process when the app exits — otherwise
            // ConPTY/stream children are orphaned and survive until reboot.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                use tauri::Manager;
                app.state::<PtyManager>().kill_all();
                app.state::<StreamJsonManager>().kill_all();
                app.state::<codex::CodexManager>().kill_all();
                app.state::<opencode::OpenCodeManager>().kill_all();
            }
        });
}
