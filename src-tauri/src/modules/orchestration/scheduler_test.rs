use std::collections::HashMap;

use super::scheduler::{
    next_nodes, reconcile, retry_decision, validate_definition, Edge, JoinStrategy, Node, NodeKind,
    NodeStatus, RetryDecision, RunDisposition, Workflow,
};

fn workflow(nodes: Vec<Node>, edges: Vec<Edge>) -> Workflow {
    Workflow {
        max_concurrency: 2,
        default_retries: 1,
        nodes,
        edges,
    }
}

fn node(id: &str, kind: NodeKind) -> Node {
    Node {
        id: id.into(),
        kind,
        retries: None,
    }
}

fn edge(source: &str, target: &str, outcome: Option<bool>) -> Edge {
    Edge {
        source: source.into(),
        target: target.into(),
        outcome,
    }
}

#[test]
fn rejects_cycles_and_invalid_limits() {
    let mut graph = workflow(
        vec![node("a", NodeKind::Agent), node("b", NodeKind::Agent)],
        vec![edge("a", "b", None), edge("b", "a", None)],
    );
    assert!(validate_definition(&graph).is_err());
    graph.edges.pop();
    graph.max_concurrency = 5;
    assert!(validate_definition(&graph).is_err());
}

#[test]
fn schedules_roots_conditions_and_all_joins() {
    let graph = workflow(
        vec![
            node("plan", NodeKind::Agent),
            node("gate", NodeKind::Condition),
            node("yes", NodeKind::Agent),
            node("no", NodeKind::Agent),
            node("join", NodeKind::Join(JoinStrategy::All)),
        ],
        vec![
            edge("plan", "gate", None),
            edge("gate", "yes", Some(true)),
            edge("gate", "no", Some(false)),
            edge("yes", "join", None),
            edge("no", "join", None),
        ],
    );
    let mut statuses = HashMap::new();
    assert_eq!(next_nodes(&graph, &statuses, &HashMap::new()), vec!["plan"]);
    statuses.insert("plan".into(), NodeStatus::Succeeded);
    assert_eq!(next_nodes(&graph, &statuses, &HashMap::new()), vec!["gate"]);
    statuses.insert("gate".into(), NodeStatus::Succeeded);
    let outcomes = HashMap::from([("gate".into(), true)]);
    assert_eq!(next_nodes(&graph, &statuses, &outcomes), vec!["yes"]);
    statuses.insert("yes".into(), NodeStatus::Succeeded);
    statuses.insert("no".into(), NodeStatus::Skipped);
    assert_eq!(next_nodes(&graph, &statuses, &outcomes), vec!["join"]);
}

#[test]
fn honors_concurrency_and_bounded_retries() {
    let graph = workflow(
        vec![
            node("a", NodeKind::Agent),
            node("b", NodeKind::Agent),
            node("c", NodeKind::Agent),
        ],
        vec![],
    );
    let statuses = HashMap::from([("a".into(), NodeStatus::Running)]);
    assert_eq!(next_nodes(&graph, &statuses, &HashMap::new()), vec!["b"]);
    assert_eq!(retry_decision(1, 1), RetryDecision::Retry { attempt: 2 });
    assert_eq!(retry_decision(2, 1), RetryDecision::Fail);
    assert_eq!(retry_decision(4, 99), RetryDecision::Fail);
}

#[test]
fn reconciliation_skips_unselected_condition_branches_and_completes() {
    let graph = workflow(
        vec![
            node("gate", NodeKind::Condition),
            node("yes", NodeKind::Agent),
            node("no", NodeKind::Agent),
            node("join", NodeKind::Join(JoinStrategy::All)),
        ],
        vec![
            edge("gate", "yes", Some(true)),
            edge("gate", "no", Some(false)),
            edge("yes", "join", None),
            edge("no", "join", None),
        ],
    );
    let statuses = HashMap::from([
        ("gate".into(), NodeStatus::Succeeded),
        ("yes".into(), NodeStatus::Succeeded),
        ("no".into(), NodeStatus::Pending),
        ("join".into(), NodeStatus::Pending),
    ]);
    let outcomes = HashMap::from([("gate".into(), true)]);

    let first = reconcile(&graph, &statuses, &outcomes);
    assert_eq!(first.skipped, vec!["no"]);
    assert_eq!(first.ready, vec!["join"]);
    assert_eq!(first.disposition, RunDisposition::Running);

    let terminal = HashMap::from([
        ("gate".into(), NodeStatus::Succeeded),
        ("yes".into(), NodeStatus::Succeeded),
        ("no".into(), NodeStatus::Skipped),
        ("join".into(), NodeStatus::Succeeded),
    ]);
    assert_eq!(
        reconcile(&graph, &terminal, &outcomes).disposition,
        RunDisposition::Completed
    );
}

#[test]
fn reconciliation_reports_waiting_and_failed_runs() {
    let graph = workflow(vec![node("approval", NodeKind::Approval)], vec![]);
    let waiting = HashMap::from([("approval".into(), NodeStatus::WaitingApproval)]);
    assert_eq!(
        reconcile(&graph, &waiting, &HashMap::new()).disposition,
        RunDisposition::Waiting
    );
    let failed = HashMap::from([("approval".into(), NodeStatus::Failed)]);
    assert_eq!(
        reconcile(&graph, &failed, &HashMap::new()).disposition,
        RunDisposition::Failed
    );
    let cancelled = HashMap::from([("approval".into(), NodeStatus::Cancelled)]);
    assert_eq!(
        reconcile(&graph, &cancelled, &HashMap::new()).disposition,
        RunDisposition::Cancelled
    );
}
