# Five-Minute Roadshow Script

## 0:00 - The Problem

Developers running several projects and AI coding tools must repeatedly inspect terminals, Git
views, and notifications. The cost is not Agent count; it is fragmented attention.

## 0:30 - Command Center

Open Astra Nexus and show the four status totals, bounded Active Sessions, Needs Attention preview,
Project Matrix, and Recent Activity. Emphasize that every row deep-links to the owning project or
Session.

## 1:15 - Handle Attention

Open Needs Attention. Approve the Codex dependency request and point out that this records a local
simulation decision only. No package command runs. Show the Session and dashboard status update.

## 2:00 - Inspect A Session

Open `Fix intermittent login timeout`. Walk through the seven Timeline event types, then open
Changes. Show the four changed files, unified diff line numbers, and binary fallback.

## 3:00 - Complete The Deterministic Run

Open Settings > Demo, reset the data, select `2x`, and advance all three steps. Explain the visible
Waiting -> Running -> Completed transition and synchronized Attention and Notifications.

## 3:45 - Review And Request Changes

Open the completion notification, return to Changes, and choose Request Changes. Enter:

> Add timeout-boundary unit tests without changing the public API.

Submit with immediate rerun enabled. Show the new user-message event, changes-requested review
state, status event, and Running status.

## 4:40 - Close

Return to Command Center. The key result is one decision surface for projects, Agent Sessions,
Attention, and read-only review. The next engineering step is real Claude/Codex adapters with
permission confirmation and audit logging, not broader execution by default.
