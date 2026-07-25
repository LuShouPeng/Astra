mod modules;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            let store = modules::orchestration::OrchestrationStore::open(
                &app_data.join("orchestration.sqlite3"),
            )?;
            store.interrupt_active_runs()?;
            app.manage(store);
            app.manage(modules::orchestration::OrchestrationRuntime::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            modules::orchestration::commands::orchestration_list_workflows,
            modules::orchestration::commands::orchestration_save_workflow,
            modules::orchestration::commands::orchestration_create_run,
            modules::orchestration::runtime::orchestration_discover_providers,
            modules::orchestration::runtime::orchestration_start_agent,
            modules::orchestration::runtime::orchestration_cancel_agent,
            modules::orchestration::extensions::orchestration_test_mcp_connection,
            modules::orchestration::extensions::orchestration_store_secret,
            modules::orchestration::extensions::orchestration_install_local_skill,
            modules::orchestration::worktrees::orchestration_prepare_run_worktree,
            modules::orchestration::worktrees::orchestration_prepare_node_worktree,
            modules::orchestration::worktrees::orchestration_integrate_node,
            modules::orchestration::worktrees::orchestration_merge_run,
            modules::workspace::workspace_inspect_path,
            modules::workspace::workspace_check_exists,
            modules::project::project_git_summary,
            modules::project::project_git_changes,
            modules::project::project_file_diff,
            modules::project::system_open_directory,
            modules::project::system_open_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Astra Nexus");
}
