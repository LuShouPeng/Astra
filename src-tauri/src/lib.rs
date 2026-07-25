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
            let database = app_data.join("orchestration.sqlite3");
            modules::orchestration::OrchestrationStore::backup_legacy_database(&database)?;
            let store = modules::orchestration::OrchestrationStore::open(&database)?;
            store.interrupt_active_runs()?;
            app.manage(store);
            app.manage(modules::orchestration::OrchestrationRuntime::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            modules::orchestration::commands::orchestration_list_workflows,
            modules::orchestration::commands::orchestration_save_workflow,
            modules::orchestration::commands::orchestration_save_template,
            modules::orchestration::commands::orchestration_list_templates,
            modules::orchestration::commands::orchestration_create_run,
            modules::orchestration::commands::orchestration_decide_run,
            modules::orchestration::commands::orchestration_cancel_run,
            modules::orchestration::commands::orchestration_resume_run,
            modules::orchestration::commands::orchestration_update_node_status,
            modules::orchestration::commands::orchestration_update_node_provider,
            modules::orchestration::commands::orchestration_get_run,
            modules::orchestration::commands::orchestration_reconcile_run,
            modules::orchestration::commands::orchestration_decide_approval,
            modules::orchestration::commands::orchestration_retry_node,
            modules::orchestration::commands::orchestration_update_node_evidence,
            modules::orchestration::runtime::orchestration_discover_providers,
            modules::orchestration::runtime::orchestration_start_agent,
            modules::orchestration::runtime::orchestration_cancel_agent,
            modules::orchestration::runtime::orchestration_plan_workflow,
            modules::orchestration::extensions::orchestration_test_mcp_connection,
            modules::orchestration::extensions::orchestration_save_mcp_server,
            modules::orchestration::extensions::orchestration_list_mcp_servers,
            modules::orchestration::extensions::orchestration_delete_mcp_server,
            modules::orchestration::extensions::orchestration_store_secret,
            modules::orchestration::extensions::orchestration_preflight_agent_capabilities,
            modules::orchestration::extensions::orchestration_install_local_skill,
            modules::orchestration::extensions::orchestration_install_git_skill,
            modules::orchestration::extensions::orchestration_call_mcp_tool,
            modules::orchestration::extensions::orchestration_register_skill,
            modules::orchestration::extensions::orchestration_list_skills,
            modules::orchestration::extensions::orchestration_uninstall_skill,
            modules::orchestration::extensions::orchestration_build_skill_context,
            modules::orchestration::extensions::orchestration_export_skill,
            modules::orchestration::worktrees::orchestration_prepare_run_worktree,
            modules::orchestration::worktrees::orchestration_prepare_node_worktree,
            modules::orchestration::worktrees::orchestration_integrate_node,
            modules::orchestration::worktrees::orchestration_merge_run,
            modules::orchestration::worktrees::orchestration_get_run_worktree,
            modules::orchestration::worktrees::orchestration_get_integration_evidence,
            modules::orchestration::worktrees::orchestration_cleanup_run_worktrees,
            modules::workspace::workspace_inspect_path,
            modules::workspace::workspace_check_exists,
            modules::project::project_git_summary,
            modules::project::project_git_changes,
            modules::project::project_file_diff,
            modules::project::system_open_directory,
            modules::project::system_open_file,
            modules::project::git_commit,
            modules::project::git_checkout,
            modules::project::git_merge,
            modules::project::git_reset,
            modules::project::git_worktree_list,
            modules::project::git_worktree_create,
            modules::project::git_worktree_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running Astra Nexus");
}
