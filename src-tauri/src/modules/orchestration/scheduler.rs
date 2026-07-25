use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JoinStrategy {
    All,
    Any,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NodeKind {
    Agent,
    McpTool,
    Approval,
    Condition,
    Join(JoinStrategy),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
    pub retries: Option<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Edge {
    pub source: String,
    pub target: String,
    pub outcome: Option<bool>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Workflow {
    pub max_concurrency: usize,
    pub default_retries: u8,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NodeStatus {
    Pending,
    Ready,
    Running,
    WaitingApproval,
    Succeeded,
    Failed,
    Skipped,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RetryDecision {
    Retry { attempt: u8 },
    Fail,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RunDisposition {
    Running,
    Waiting,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reconciliation {
    pub ready: Vec<String>,
    pub skipped: Vec<String>,
    pub disposition: RunDisposition,
}

pub fn validate_definition(workflow: &Workflow) -> Result<(), String> {
    if workflow.nodes.is_empty() {
        return Err("Workflow must contain at least one node.".into());
    }
    if !(1..=4).contains(&workflow.max_concurrency) || workflow.default_retries > 3 {
        return Err("Workflow runtime limits are invalid.".into());
    }
    let ids: HashSet<_> = workflow.nodes.iter().map(|node| node.id.as_str()).collect();
    if ids.len() != workflow.nodes.len()
        || workflow
            .nodes
            .iter()
            .any(|node| node.id.is_empty() || node.retries.is_some_and(|value| value > 3))
    {
        return Err("Workflow node identifiers or retry limits are invalid.".into());
    }
    if workflow
        .edges
        .iter()
        .any(|edge| !ids.contains(edge.source.as_str()) || !ids.contains(edge.target.as_str()))
    {
        return Err("Workflow contains a dangling edge.".into());
    }

    let mut indegree = ids
        .iter()
        .map(|id| (*id, 0_usize))
        .collect::<HashMap<_, _>>();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &workflow.edges {
        *indegree.entry(&edge.target).or_default() += 1;
        outgoing.entry(&edge.source).or_default().push(&edge.target);
    }
    let mut queue = indegree
        .iter()
        .filter_map(|(id, count)| (*count == 0).then_some(*id))
        .collect::<VecDeque<_>>();
    let mut visited = 0;
    while let Some(id) = queue.pop_front() {
        visited += 1;
        for target in outgoing.get(id).into_iter().flatten() {
            let count = indegree.get_mut(target).expect("validated target");
            *count -= 1;
            if *count == 0 {
                queue.push_back(target);
            }
        }
    }
    if visited != workflow.nodes.len() {
        return Err("Workflow graph must be acyclic.".into());
    }
    Ok(())
}

fn edge_is_selected(edge: &Edge, outcomes: &HashMap<String, bool>) -> bool {
    match edge.outcome {
        Some(expected) => outcomes
            .get(&edge.source)
            .is_some_and(|actual| *actual == expected),
        None => true,
    }
}

fn dependency_complete(status: Option<&NodeStatus>) -> bool {
    matches!(status, Some(NodeStatus::Succeeded | NodeStatus::Skipped))
}

pub fn next_nodes(
    workflow: &Workflow,
    statuses: &HashMap<String, NodeStatus>,
    condition_outcomes: &HashMap<String, bool>,
) -> Vec<String> {
    if validate_definition(workflow).is_err() {
        return Vec::new();
    }
    let active = statuses
        .values()
        .filter(|status| matches!(status, NodeStatus::Ready | NodeStatus::Running))
        .count();
    let available = workflow.max_concurrency.saturating_sub(active);
    if available == 0 {
        return Vec::new();
    }

    workflow
        .nodes
        .iter()
        .filter(|node| matches!(statuses.get(&node.id), None | Some(NodeStatus::Pending)))
        .filter(|node| {
            let incoming = workflow
                .edges
                .iter()
                .filter(|edge| edge.target == node.id)
                .collect::<Vec<_>>();
            if incoming.is_empty() {
                return true;
            }
            let selected = incoming
                .iter()
                .filter(|edge| edge_is_selected(edge, condition_outcomes))
                .collect::<Vec<_>>();
            if selected.is_empty() {
                return false;
            }
            match node.kind {
                NodeKind::Join(JoinStrategy::Any) => selected
                    .iter()
                    .any(|edge| statuses.get(&edge.source) == Some(&NodeStatus::Succeeded)),
                _ => selected
                    .iter()
                    .all(|edge| dependency_complete(statuses.get(&edge.source))),
            }
        })
        .take(available)
        .map(|node| node.id.clone())
        .collect()
}

pub fn retry_decision(attempt: u8, configured_retries: u8) -> RetryDecision {
    let retries = configured_retries.min(3);
    if attempt > 0 && attempt <= retries {
        RetryDecision::Retry {
            attempt: attempt + 1,
        }
    } else {
        RetryDecision::Fail
    }
}

pub fn reconcile(
    workflow: &Workflow,
    statuses: &HashMap<String, NodeStatus>,
    condition_outcomes: &HashMap<String, bool>,
) -> Reconciliation {
    let skipped = workflow
        .nodes
        .iter()
        .filter(|node| matches!(statuses.get(&node.id), None | Some(NodeStatus::Pending)))
        .filter(|node| {
            let incoming = workflow
                .edges
                .iter()
                .filter(|edge| edge.target == node.id)
                .collect::<Vec<_>>();
            !incoming.is_empty()
                && incoming.iter().all(|edge| {
                    edge.outcome.is_some()
                        && condition_outcomes.contains_key(&edge.source)
                        && !edge_is_selected(edge, condition_outcomes)
                })
        })
        .map(|node| node.id.clone())
        .collect::<Vec<_>>();
    let mut effective = statuses.clone();
    for node_id in &skipped {
        effective.insert(node_id.clone(), NodeStatus::Skipped);
    }
    let ready = next_nodes(workflow, &effective, condition_outcomes);
    let disposition = if effective
        .values()
        .any(|status| *status == NodeStatus::Failed)
    {
        RunDisposition::Failed
    } else if effective
        .values()
        .any(|status| *status == NodeStatus::Cancelled)
    {
        RunDisposition::Cancelled
    } else if effective
        .values()
        .any(|status| *status == NodeStatus::Interrupted)
    {
        RunDisposition::Interrupted
    } else if effective
        .values()
        .any(|status| *status == NodeStatus::WaitingApproval)
    {
        RunDisposition::Waiting
    } else if workflow.nodes.iter().all(|node| {
        matches!(
            effective.get(&node.id),
            Some(NodeStatus::Succeeded | NodeStatus::Skipped)
        )
    }) {
        RunDisposition::Completed
    } else {
        RunDisposition::Running
    };
    Reconciliation {
        ready,
        skipped,
        disposition,
    }
}
