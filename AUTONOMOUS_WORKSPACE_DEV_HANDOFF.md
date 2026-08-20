# Autonomous Workspace Developer Handoff

## Runtime ownership

Use the existing `ServerSDK`, `server-sync`, session reducer, VCS/review state, provider/model state, and terminal context. The workspace is mounted in `pages/session.tsx` under the active session page owner and is disabled by default. The controller is instantiated directly in that owner; there is no autonomous-workspace context provider or second global bridge. Enabling it wraps the existing conversation/composer and reuses the existing terminal panel; it does not replace or duplicate those systems.

The controller scope is `(serverID, directory, sessionID)`. It listens through the already normalized `ServerSDK.event` path and is cleaned up when the active session scope changes or is disposed. Do not add `EventSource`, raw SSE parsing, global runtime buffers, or a second terminal/diff store.

## Data-flow map

```text
OpenCode event/session/message/VCS/terminal APIs
  -> ServerSDK + server-sync/session reducer
  -> active session page owner
  -> session-workspace-lifecycle
  -> createSessionWorkspaceController
  -> contracts/selectors
  -> AutonomousWorkspace, SessionLineageCenter, ExecutionTimeline,
     ChangesReviewCenter, ContextIntelligence
```

### Session lineage — DERIVED

Lineage uses real session records and `Session.parentID`. It is not multi-agent orchestration. Missing parent, cyclic, duplicate, or cross-scope relationships are unavailable. Agent task/progress/current-tool claims are intentionally not rendered because the current OpenCode contract does not establish those semantics here.

### Timeline — LIVE/DERIVED

The controller maps an explicit allowlist of normalized runtime event types to localized categories. Official event IDs are preferred. Id-less fallback identities contain server, directory, session, event type, and stable domain identity; repeatable progress also requires an upstream timestamp. Timeline retention is bounded and reset on resync. No raw prompt, delta, tool input/output, command output, file content, or error detail is rendered.

### Review and diffs — LIVE/DERIVED

The workspace changes view projects the existing VCS/session diff data. Added, modified, deleted, renamed, unsupported, unknown, empty, and loading/error states must remain truthful. Review mutations are not implemented in the workspace; any future revert/apply/approve/stage/commit action must use an existing authorized server operation.

### Metrics — LIVE when supplied

Provider, model, input/output/reasoning/cache/total token counts, and cost are read from authoritative assistant message metadata. Missing context limits, percentages, pricing, speed, and other inferred values are unavailable.

### Terminal — LIVE

The workspace composes the existing `TerminalPanel`/`TerminalPanelV2` and `TerminalProvider`. Server, project, directory, focus, resize, reconnect, and PTY cleanup semantics remain in the existing terminal subsystem.

### Preferences — PERSISTED LAYOUT ONLY

`workspace-preferences.ts` stores a validated version-1 preference scoped by server and directory. It contains only enabled/view/expanded-panel/expanded-lineage-layout/context-tab fields. The context panel exposes Usage and a Timeline activity summary from normalized events. It never stores event history, streaming truth, connectivity, authorization, credentials, or messages; lineage IDs are bounded layout hints only. Invalid state falls back to conversation mode.

## Encryption scope

The branch’s `APP_ENCRYPTION_DISABLED=1` and encryption-key behavior are separate security-review scope. This workspace integration does not weaken encryption, add keys, or make plaintext credentials acceptable. Keep encryption changes isolated when reviewing or splitting commits.

## Acceptance checklist

1. Run focused workspace controller/lifecycle/contract/preference/i18n/browser tests.
2. Run app typecheck, root typecheck, unit tests, browser tests, stability tests, build, and E2E against a real OpenCode backend.
3. Exercise session switch, server/project isolation, reconnect/resync, interrupt, reload, terminal reuse, review projection, and mobile/WebKit layouts.
4. Check console/network errors and confirm no global workspace event singleton, fabricated telemetry, hardcoded visible strings, or persisted runtime truth remains.

Current capabilities are LIVE or DERIVED only where listed above. Unsupported agent hierarchy and destructive review actions remain UNAVAILABLE/FUTURE.

## Connected acceptance matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Connected backend | PASS (local) | Authenticated real OpenCode 1.18.18, v2, `127.0.0.1:4096`, project `/`; `100.97.224.96:4096` was TCP-refused in this environment. |
| Workspace mount and real prompt | PASS | Production Bun build served the SPA; real prompt response rendered after the session route transition. |
| Timeline, lineage, Usage/Activity | PASS (smoke) | Views mounted and rendered from scoped state; no fabricated metrics were introduced. |
| Review/diff | PENDING | Test project has no Git repository, so no authoritative diff was available. |
| Terminal | PENDING | No-Git test project did not provide a safe PTY acceptance target. |
| Interrupt/reconnect | PENDING | Needs controlled long-running generation/network interruption. |
| Persistence/reload | PASS (smoke) | Bootstrap settlement now gates first-run setup; fresh contexts did not show the setup dialog over an already registered backend, and workspace navigation remained available after reload. |
| Chromium | PASS (smoke) | Installed repository Playwright Chromium and completed connected prompt/workspace flow. |
| WebKit/mobile/tablet | PASS (smoke) | Connected prompt/workspace flow passed in WebKit; phone/tablet/landscape Chromium viewports had no horizontal overflow. WebKit emitted only the existing ResizeObserver lifecycle warning. |
| Stability/CI | PARTIAL / classified | Visual stability unit tests passed (23/23). Playwright stability uses a synthetic fixture page and did not pass against the production route; the full stability command also exceeds the local 120s web-server timeout because build time is ~11m33s. Both Vercel failures require authenticated Vercel project logs; GitHub status metadata alone does not show a branch-code cause. |
