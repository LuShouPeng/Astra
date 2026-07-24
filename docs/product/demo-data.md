# Demo Data Guide

## Frozen Portfolio

| Project     | Session                                  | Provider | Initial status | Current action                 |
| ----------- | ---------------------------------------- | -------- | -------------- | ------------------------------ |
| backend-api | Fix intermittent login timeout           | Claude   | Running        | Review auth service call paths |
| backend-api | Add authentication unit tests            | Codex    | Completed      | Ready for review               |
| backend-api | Update API documentation                 | Gemini   | Completed      | Display-only demo Session      |
| frontend    | Fix mobile navigation layout             | Codex    | Waiting        | Dependency approval            |
| frontend    | Refactor global state management         | Claude   | Failed         | TypeScript typecheck failed    |
| ai-service  | Optimize inference service configuration | Gemini   | Running        | Display-only demo Session      |

The timeout Session owns four demo changes: three text files and one binary image fallback. Its
Timeline includes user, Agent, status, command, file-change, test, and approval events.

## Deterministic Playback

Playback targets `session-backend-claude` and has exactly three steps:

1. Move to Waiting and create an approval event, Attention item, and notification.
2. Record approval, resolve Attention, mark the notification read, and return to Running.
3. Complete 18 tests, move to Completed, create Review attention, and add a completion notification.

Settings > Demo supports play/pause, single-step, reset, and `0.5x`, `1x`, or `2x` playback.
Reset always restores the same IDs and timestamps.

## Performance Fixtures

`createPerformanceSnapshot()` produces exactly 100 Sessions and 500 Timeline events. Rendering is
bounded to six Active Sessions on Command Center, five Attention preview items, 30 Sessions per
expanded project tree, and Timeline batches of 100 events.

## Capture

Start the acceptance server, then run:

```powershell
npm run dev -- --host 127.0.0.1 --mode acceptance
npm run demo:capture
```

The capture script records real application UI at 1280x720. It never executes an Agent command or
changes a Git repository.
