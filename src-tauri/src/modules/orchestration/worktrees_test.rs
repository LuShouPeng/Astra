use std::{
    fs,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use super::worktrees::WorktreeManager;

fn temp(label: &str) -> std::path::PathBuf {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let p = std::env::temp_dir().join(format!("astra-worktree-{label}-{n}"));
    fs::create_dir_all(&p).unwrap();
    p
}
fn git(root: &std::path::Path, args: &[&str]) {
    assert!(Command::new("git.exe")
        .arg("-C")
        .arg(root)
        .args(args)
        .status()
        .unwrap()
        .success());
}

#[test]
fn creates_node_worktree_and_integrates_managed_commit() {
    let root = temp("repo");
    let cache = temp("cache");
    git(&root, &["init"]);
    git(&root, &["config", "user.name", "Astra Test"]);
    git(&root, &["config", "user.email", "astra@example.test"]);
    fs::write(root.join("README.md"), "base\n").unwrap();
    git(&root, &["add", "README.md"]);
    git(&root, &["commit", "-m", "initial"]);
    let manager = WorktreeManager::new(&root, &cache).expect("manager");
    let run = manager.prepare_run("run-1").expect("run worktree");
    let node = manager.prepare_node(&run, "node-1").expect("node worktree");
    fs::write(node.path.join("feature.txt"), "done\n").unwrap();
    let commit = manager
        .commit_node(&node, "workflow-1", "run-1", "node-1")
        .expect("commit");
    assert!(!commit.is_empty());
    manager.integrate_node(&run, &node).expect("integrate");
    assert!(run.path.join("feature.txt").is_file());
    manager.cleanup_run(&run.id).expect("cleanup run");
    drop(manager);
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(cache).unwrap();
}

#[test]
fn final_merge_returns_the_managed_merge_commit() {
    let root = temp("approval-repo");
    let cache = temp("approval-cache");
    git(&root, &["init"]);
    git(&root, &["config", "user.name", "Astra Test"]);
    git(&root, &["config", "user.email", "astra@example.test"]);
    fs::write(root.join("README.md"), "base\n").unwrap();
    git(&root, &["add", "README.md"]);
    git(&root, &["commit", "-m", "initial"]);
    let manager = WorktreeManager::new(&root, &cache).unwrap();
    let run = manager.prepare_run("run-2").unwrap();
    let node = manager.prepare_node(&run, "node-2").unwrap();
    fs::write(node.path.join("feature.txt"), "done\n").unwrap();
    manager
        .commit_node(&node, "workflow-2", "run-2", "node-2")
        .unwrap();
    manager.integrate_node(&run, &node).unwrap();
    let commit = manager.merge_to_user_branch(&run).unwrap();
    assert!(!commit.is_empty());
    assert!(root.join("feature.txt").is_file());
    manager.cleanup_run(&run.id).expect("cleanup run");
    drop(manager);
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(cache).unwrap();
}

#[test]
fn aborts_conflicting_node_integration_and_keeps_the_run_worktree_clean() {
    let root = temp("conflict-repo");
    let cache = temp("conflict-cache");
    git(&root, &["init"]);
    git(&root, &["config", "user.name", "Astra Test"]);
    git(&root, &["config", "user.email", "astra@example.test"]);
    fs::write(root.join("README.md"), "base\n").unwrap();
    git(&root, &["add", "README.md"]);
    git(&root, &["commit", "-m", "initial"]);
    let manager = WorktreeManager::new(&root, &cache).unwrap();
    let run = manager.prepare_run("run-conflict").unwrap();
    let first = manager.prepare_node(&run, "first").unwrap();
    let second = manager.prepare_node(&run, "second").unwrap();
    fs::write(first.path.join("README.md"), "first\n").unwrap();
    fs::write(second.path.join("README.md"), "second\n").unwrap();
    manager
        .commit_node(&first, "workflow", "run-conflict", "first")
        .unwrap();
    manager
        .commit_node(&second, "workflow", "run-conflict", "second")
        .unwrap();
    manager.integrate_node(&run, &first).unwrap();
    assert!(manager.integrate_node(&run, &second).is_err());
    let status = Command::new("git.exe")
        .arg("-C")
        .arg(&run.path)
        .args(["status", "--porcelain"])
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(status.stdout.is_empty());
    manager.cleanup_run(&run.id).expect("cleanup run");
    drop(manager);
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(cache).unwrap();
}
