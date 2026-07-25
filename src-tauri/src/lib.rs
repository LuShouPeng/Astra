mod modules;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            modules::workspace::workspace_inspect_path,
            modules::workspace::workspace_check_exists,
            modules::project::project_git_summary,
            modules::project::project_git_changes,
            modules::project::project_file_diff,
            modules::project::system_open_directory,
            modules::project::system_open_file,
            modules::agent_capability::discover_agent_capabilities
        ])
        .run(tauri::generate_context!())
        .expect("error while running Astra Nexus");
}
