# Autonomous Workspace Developer Handoff

## Integration boundary
Mount the autonomous workspace components from a session workspace controller. Feed them normalized data from `packages/app/src/features/autonomous-workspace/contracts.ts`; do not make individual components parse SSE or SDK transport payloads.

## Agent runtime telemetry
**Frontend:** `AgentCommandCenter`, `AgentRuntimeSnapshot`, `agentTree`.
**Current source:** no production multi-agent snapshot is currently exposed to this surface; the component renders an explicit empty state.
**Missing:** authoritative agent id, parent id, lifecycle state, task, model/provider, current tool/file, timestamps, progress, and last activity.
**Expected contract:** emit idempotent snapshots keyed by agent id. Parent ids must reference the same session, state transitions must be monotonic unless a documented retry/cancellation occurs, and `updatedAt` must be runtime time.
**Failure/recovery:** show unknown on disconnect, replace snapshots on session reload, ignore duplicate event ids, reject stale updates by timestamp, and rebuild the tree after reconnect.
**Tests/acceptance:** replay a session with nested agents, reconnect mid-run, reorder events, and verify rows converge to the authoritative snapshot without fabricated timers.

## Multi-agent hierarchy
Persist or derive delegation relationships in the runtime event stream. Do not infer hierarchy from labels or visual nesting. Verify deep nesting is rendered as bounded indentation with keyboard tree navigation.

## Execution event normalization
**Frontend:** `AgentExecutionEvent`, `ExecutionTimeline`.
**Missing:** stable event id, event timestamp semantics, operation kind, agent id, start/end or duration, retry relationship, and output truncation metadata.
**Expected contract:** stable `id`, `timestamp` in epoch milliseconds, one normalized kind, explicit state, and optional detail/output. Deduplicate by id; order by timestamp with stable id tie-breaker; mark missing/reordered data unknown rather than inventing completion.
**Acceptance:** 100 events, duplicate events, delayed completion, failed tool, cancellation, and large output all remain usable on mobile.

## Changes and Git integration
**Frontend:** `WorkspaceChange`, `ChangesReviewCenter`; existing `ReviewPanelV2` remains the full diff viewer.
**Current source:** existing review/diff APIs can be adapted through `workspaceChangeFromDiff`.
**Missing:** authoritative repository status, patch loading, file permissions, test association, and authorized mutation endpoints.
**Security:** revert, approve, reject, shell, and Git mutations must be authorized server operations. Do not wire destructive buttons to frontend state.
**Acceptance:** added/modified/deleted/renamed/binary/unavailable files have explicit states; diff load failures are recoverable; no action is presented as successful before the server confirms it.

## Context telemetry
**Frontend:** `ContextUsageSnapshot`, `ContextIntelligence`, `contextUsageFromMessage`.
**Current source:** assistant message token/cost fields when present.
**Missing:** provider/model context limit, authoritative context-used value, pricing semantics, and activity rate.
**Expected contract:** provider/model ids, input/output tokens, optional total, optional context used/limit, optional cost, and runtime timestamp. Omit unavailable fields. Never assume limits or prices from a model name.
**Acceptance:** populated, empty, unknown, stale, and failed usage responses render distinctly.

## Runtime health and persistence
Use existing server-sync health state for `RuntimeHealthSnapshot`. Panel layout and selected view should use existing persistence helpers rather than a new store. Profile large agent/event/diff datasets with virtualization before enabling production-scale views.

## Prioritized backlog
### P0 — required for correct runtime integration
- Wire normalized agent snapshots to server-sync; add duplicate/stale/reconnect tests.
- Normalize SSE/tool events into `AgentExecutionEvent`; test ordering, retries, cancellation, and missing events.
- Adapt existing diff APIs into `WorkspaceChange`; verify authorization before any mutation.
- Expose model/provider context limits and usage from authoritative runtime metadata.

### P1 — required for production UX
- Mount panels in the session workspace controller with responsive drawer behavior.
- Add command-palette entries for Agent Center, Timeline, Changes, Context, Conversation, and Terminal.
- Add keyboard focus restoration and screen-reader announcements for reconnecting/failed runtime states.
- Virtualize long timelines and change lists; profile with production-size fixtures.

### P2 — enhancement
- Agent explanations linked to timeline events and changed files.
- Context contributor breakdown when the runtime exposes source attribution.
- Workspace presets for conversation, agent, review, and monitoring views.

### P3 — optional/future
- Persistent multi-session agent history.
- Collaborative review annotations and approval workflows.

## Final integration gate
Run typecheck, focused contract tests, app unit/e2e/stability tests, production build, browser QA at 375/768/1280 widths, keyboard and reduced-motion checks, console/network review, and a security review for every server/filesystem/Git action.
