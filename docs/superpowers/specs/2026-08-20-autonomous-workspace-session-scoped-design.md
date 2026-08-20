# Session-Scoped Autonomous Workspace Design

## Goal

Integrate v0's autonomous-workspace presentation into the existing session runtime without creating a second event, review, model, or terminal state system.

## Scope and invariants

- The active server, directory, and session scope owns workspace-derived state.
- Existing `ServerSDK`, session reducers, review state, model state, and terminal context remain authoritative.
- OpenCode event identity is preserved whenever supplied. A scoped fallback is used only when the event has no authoritative identifier.
- Replay, reconnect, session changes, server changes, and disposal cannot let stale events mutate the active workspace.
- The timeline is bounded, deduplicated, deterministically ordered, and never canonical application state.
- `Session.parentID` is presented as derived session lineage, not as confirmed agent delegation.
- Metrics are shown only when supplied by the current authoritative session/message metadata. Context limits, pricing projections, agent progress, and timers are unavailable unless OpenCode supplies them.
- Review stays read-only and projects the existing authoritative diff state. Terminal stays the existing terminal subsystem.
- Persisted data is limited to validated workspace layout preferences. It excludes events, active state, credentials, and runtime truth.
- New visible copy uses the typed application i18n system.
- Encryption changes are reviewed and committed separately from workspace behavior.

## Data flow

```text
OpenCode typed event / authoritative session state
  -> ServerSDK event normalization and existing session reducer
  -> SessionWorkspaceController(server scope, directory, session id)
  -> controller selectors (timeline, lineage, metrics, diffs, preferences)
  -> AutonomousWorkspace presentation components
```

The controller receives already normalized `ServerEvent` values from the existing `ServerSDK` event emitter. It does not parse SSE, create an event connection, or replace reducer reconciliation. It discards events outside its exact scope and clears transient timeline entries when its owner is disposed or reset. Resync derives the current visible truth from the existing session/review stores; retained timeline entries are diagnostic presentation only.

## Timeline contract

Only explicitly supported event types are mapped: session activity/idle/error, tool lifecycle, permission/question requests, session diffs, file edits, retries, and model/agent configuration changes where the official event contracts provide the required identifiers. Unmapped event types render as a neutral, explicitly unknown runtime event only if they belong to the active session and have safe display metadata.

Timeline identity uses the official event id first. If unavailable, it includes server scope, directory, session id, event type, domain identifiers such as message/part/tool call id, timestamp, and a deterministic collision ordinal. The buffer maintains a bounded ordered map. Duplicate identity never emits a second state update or subscriber notification. Ordering is timestamp then stable identity; stale events cannot replace later authoritative state.

## Lineage and metrics

Lineage is reconstructed only from scoped `Session.parentID` records already held by the session store. Missing, cross-scope, and unresolved parents remain unavailable rather than inferred. The presentation uses lineage terminology.

Metrics use existing assistant/session token and cost metadata. Cache read/write and reasoning tokens are included only where they are separate authoritative fields. No context percentage is rendered without a supplied context limit.

## Review and terminal

The Changes view projects the existing session/review diff selector and uses the existing review panel for inspection. It exposes no browser-originated git mutation. The workspace mounts the existing `TerminalPanel`/terminal context in its terminal view without creating PTYs or altering permission behavior.

## Preferences

Preferences are stored under a versioned, server/directory/session-independent layout key and parsed through a strict schema. Valid values are workspace enabled state, selected workspace view, and expansion state. Invalid JSON, unsupported versions, or unknown view ids resolve to the current safe default.

## Validation

Tests begin with failing reproductions for current bridge identity collision, duplicate notification, global scope leakage, stale replay, bounded retention, and disposal. Controller tests then cover official typed events and authoritative state projections. Existing performance timeline tests establish a baseline before session/timeline changes and run again after the integration. Browser tests exercise opt-in enable/disable, stream/reconnect, review, terminal reuse, persistence, mobile layout, and accessibility. The production encryption bypass is tracked as a separate security-review scope.
