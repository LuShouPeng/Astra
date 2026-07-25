mod modules;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let terminal_manager = modules::terminal::TerminalManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(terminal_manager)
        .invoke_handler(tauri::generate_handler![
            modules::workspace::workspace_inspect_path,
            modules::workspace::workspace_check_exists,
            modules::project::project_git_summary,
            modules::project::project_git_changes,
            modules::project::project_file_diff,
            modules::project::system_open_directory,
            modules::project::system_open_file,
            modules::terminal::terminal_create_session,
            modules::terminal::terminal_write_input,
            modules::terminal::terminal_read_output,
            modules::terminal::terminal_execute_command,
            modules::terminal::terminal_confirm_command,
            modules::terminal::terminal_cancel_command,
            modules::terminal::terminal_resize,
            modules::terminal::terminal_get_session_info,
            modules::terminal::terminal_close_session,
            modules::terminal::terminal_list_sessions,
            modules::terminal::terminal_add_command_rule,
            modules::terminal::terminal_get_command_rules,
            modules::terminal::terminal_change_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Astra Nexus");
}
