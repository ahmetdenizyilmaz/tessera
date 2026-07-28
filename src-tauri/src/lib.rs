pub mod auth;
pub mod computer;
pub mod pty;
pub mod relay;
pub mod sessions;
pub mod system;
pub mod util;
pub mod ws;
pub mod db;
pub mod stream;
pub mod agents;
pub mod checkpoints;
pub mod mcp;
pub mod analytics;
pub mod llm;

use db::Database;
use pty::manager::PtyManager;
use relay::client::RelayClient;
use stream::manager::StreamJsonManager;
use analytics::posthog::PostHogTracker;

pub fn run() {
    let database = Database::new().expect("Failed to initialize database");

    tauri::Builder::default()
        .manage(PtyManager::new())
        .manage(RelayClient::new())
        .manage(StreamJsonManager::new())
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
            // PTY commands
            pty::manager::pty_spawn,
            pty::manager::pty_write,
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
            sessions::usage_parser::session_parse_usage,
            sessions::usage_parser::session_parse_recent_usage,
            sessions::usage_checker::check_claude_usage,
            sessions::image_saver::save_chat_image,
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
            llm::keystore::llm_get_api_key,
            llm::keystore::llm_set_api_key,
            llm::keystore::llm_delete_api_key,
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
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                use tauri::Manager;
                app.state::<PtyManager>().kill_all();
                app.state::<StreamJsonManager>().kill_all();
            }
        });
}
