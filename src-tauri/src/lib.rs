mod modules;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(modules::agent_runtime::AgentRegistry::default())
        .invoke_handler(tauri::generate_handler![
            modules::workspace::workspace_inspect_path,
            modules::workspace::workspace_check_exists,
            modules::project::project_git_summary,
            modules::project::project_git_changes,
            modules::project::project_file_diff,
            modules::project::system_open_directory,
            modules::project::system_open_file,
            modules::agent_capability::discover_agent_capabilities,
            modules::agent_runtime::agent_start,
            modules::agent_runtime::agent_send_input,
            modules::agent_runtime::agent_stop,
            modules::agent_runtime::agent_list_running,
            modules::agent_runtime::agent_open_login,
            modules::session_persistence::session_log_append,
            modules::session_persistence::session_log_read
        ])
        .build(tauri::generate_context!())
        .expect("error while running Astra Nexus")
        .run(|app, event| {
            // Kill all live agent process trees when the app is shutting down
            // so CLI children never outlive the window (orphan prevention).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let registry = app.state::<modules::agent_runtime::AgentRegistry>();
                registry.kill_all_blocking();
            }
        });
}
