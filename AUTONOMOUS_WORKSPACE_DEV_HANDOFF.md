# Autonomous Workspace Developer Handoff

## Focused defect-closure gate — 2026-08-20 (authoritative)

The latest focused pass closes the previously reported timeline, WebKit terminal,
interrupt, reconnect, and exact-origin remote-registration blockers. The broad
application E2E suite is still not green, so this document does not claim full
production closure.

| Area | Result | Evidence |
| --- | --- | --- |
| Branch | PASS | Starting feature SHA `9e78a6e5ab2ee0a716327c7af2e405cf1b11a9a9`; `origin/main` `918d6c51ad1e6d9fe653feba08879ec86bac4a34`; main untouched. |
| Encryption | PASS | Ephemeral 32-byte `APP_ENCRYPTION_KEY` supplied only in process environments; `APP_ENCRYPTION_DISABLED=1` was not used for acceptance. |
| Playwright | PASS | Package version `1.59.1`; Chromium and WebKit launch. |
| Timeline | PASS | Focused timeline suite 12/12; fresh stability analyzer 23/23 and browser phase 88/88. |
| Terminal | PASS | Focused terminal focus/visibility suite 8/8 across Chromium/WebKit. |
| Interrupt/reconnect | PASS (focused) | 18/18 across Chromium/WebKit, including interruption, follow-up, stream lifecycle, replay, and resync checks. |
| Remote backend | PASS | Exact private origin allowlisted via environment; `srv_2f9736e138ce8bde` returned READY/v2/reachable/authenticated/healthy through the application. |
| Unit/browser | PASS — BASELINE WARNING | 932 unit passes; browser 50 passes plus the unchanged Solid cleanup failure, identical on clean `origin/main`. |
| Full E2E | FAIL | Fresh 230 tests: 161 passed, 69 failed, 0 skipped. Failures remain in review/file fixtures, prompt/model fixture expectations, request-dock route assertions, WebKit Chromium-only CDP coverage, terminal-tab fixtures, and smoke timeline fixtures. |
| Vercel | BLOCKED — AUTH REQUIRED | Red `opencode-web-ui` and `opencode-web-ui-ct` checks cannot be classified from deployment logs without authenticated Vercel access. |
| Readiness | 8.6/10 | Focused blockers are closed; full E2E prevents the requested >=9.5/10 production score. |

The committed changes are limited to browser regression/stability harness behavior:
they preserve the session-scoped controller, existing PTY/runtime ownership,
virtualized timeline, exact-origin security, and production application behavior.

## E2E closure pass — 2026-08-21

The latest fixture pass corrected two repository-controlled issues: `/vcs/diff` was
being swallowed by the generic empty-list mock before configured review data could
reach the application, and the model projection was fabricating release timestamps
and costs instead of preserving fixture metadata. The context-resize transition test
that uses `page.context().newCDPSession()` is explicitly Chromium-scoped because
CPU throttling is a Chrome DevTools Protocol capability; its first test retains
Chromium/WebKit product-level coverage.

The local Playwright browser download could not complete in the sandbox, so a fresh
full matrix could not be executed after these changes. `typecheck:e2e` and `git
diff --check` pass; do not treat this environment limitation as a green full-E2E
result.

## Historical acceptance record — superseded

The authoritative current gate is tracked here; older provisional notes below are
historical and must not be read as final production acceptance.

| Area | Result | Evidence |
| --- | --- | --- |
| Branch | PASS | Work remains on `encryption-key-configuration`; `main` is untouched. |
| Encryption | PASS | Normal local acceptance used a non-committed, ephemeral 32-byte `APP_ENCRYPTION_KEY`; plaintext mode was not used for acceptance. |
| Playwright | PASS | Local package version `1.59.1`; Chromium and WebKit binaries launch. |
| Real session/workspace | PASS | Authenticated local OpenCode v2 session mounted the opt-in workspace and streamed a real prompt. |
| Review/diff | PASS | Real Git-backed acceptance file modification was reflected by Git and the workspace review. |
| Remote target | PASS / CONFIGURED | `http://100.97.224.96:4096` is reachable and responds to authenticated health/project requests; application registration additionally requires its exact private origin in `OPENCODE_ALLOWED_SERVERS`. |
| Unit/browser | PASS — BASELINE WARNING | 932 unit tests passed; browser suite remains 50 passed plus the identical Solid cleanup failure on clean `origin/main`. |
| Targeted browser E2E | PASS | 15/15 repaired registry/control-plane specs passed; workspace timeline/accessibility smoke passed in Chromium and WebKit. |
| Full E2E | FAIL — 78 PASS / 152 FAIL (pre-helper rerun) | The complete 230-test Chromium/WebKit matrix executed with an isolated control-plane DB and explicit port before the WebKit deferred-helper correction; no tests were skipped. The post-correction focused subset was 3/6, with three terminal focus/visibility failures; a clean final full-matrix result is not claimed. |
| Stability | FAIL — 81 PASS / 7 FAIL | Analyzer 23/23 passed and the prebuilt-serve browser phase executed; two Chromium and five WebKit timeline virtualization/scroll cases failed. |
| Vercel – opencode-web-ui / -ct | BLOCKED — AUTH REQUIRED | GitHub status metadata identifies failing deployments, but no authenticated Vercel logs are available in this environment. |

Keep the workspace session-scoped and derived from authoritative state. Do not
restore a global event bridge, fabricate telemetry, or use `APP_ENCRYPTION_DISABLED=1`
for production-style acceptance.

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

## Historical connected acceptance matrix — superseded

| Area | Result | Evidence |
| --- | --- | --- |
| Connected backend | PASS (local) / PASS (remote direct) | Authenticated real OpenCode 1.18.18, v2, `127.0.0.1:4096`, project `/`; direct authenticated health/project requests to `100.97.224.96:4096` also passed. Isolated application registration of the private origin requires the exact `OPENCODE_ALLOWED_SERVERS` entry. |
| Workspace mount and real prompt | PASS | Production Bun build served the SPA; real prompt response rendered after the session route transition. |
| Timeline, lineage, Usage/Activity | PASS (smoke) | Views mounted and rendered from scoped state; no fabricated metrics were introduced. |
| Review/diff | PASS (local) | A disposable Git-backed acceptance project was modified by a real prompt and matched by Git/workspace review. |
| Terminal | NOT CLOSED | The existing PTY path was not proven cleanly in the final connected acceptance window. |
| Interrupt/reconnect | NOT CLOSED | Streaming passed, but controlled interrupt/reconnect evidence is incomplete. |
| Persistence/reload | PASS (smoke) | Bootstrap settlement now gates first-run setup; fresh contexts did not show the setup dialog over an already registered backend, and workspace navigation remained available after reload. |
| Chromium | PASS (smoke) | Installed repository Playwright Chromium and completed connected prompt/workspace flow. |
| WebKit/mobile/tablet | PASS (smoke) | Connected prompt/workspace flow passed in WebKit; phone/tablet/landscape Chromium viewports had no horizontal overflow. WebKit emitted only the existing ResizeObserver lifecycle warning. |
| Stability/CI | FAIL / classified | Visual analyzer passed 23/23; the complete prebuilt browser phase was 81/88. Both Vercel failures require authenticated Vercel project logs; GitHub status metadata alone does not show a branch-code cause. |

## Acceptance evidence

- `bun run typecheck`: passed.
- `bun --cwd packages/app typecheck:e2e`: passed.
- `bun --cwd packages/app test`: 50 browser tests passed; one known Solid cleanup failure remains (`route cleanup cannot invalidate an owner list being disposed`), matching clean `origin/main`.
- `bun --cwd packages/app test:unit`: 932 tests passed, 0 failed.
- `bun --cwd packages/app test:e2e`: pre-helper matrix 78 passed, 152 failed out of 230; the full matrix executed without skips. After replacing WebKit-only `Promise.withResolvers` helpers, the focused affected subset was 3 passed / 3 failed, with the remaining failures in terminal focus/visibility behavior.
- Visual stability unit analyzer: passed, 23 tests / 0 failures.
- `bun run db:check`: passed.
- Stability harness: `test:stability` built once, served prebuilt `dist` on `PLAYWRIGHT_STABILITY_PORT=4174`, and completed 88 browser tests: 81 passed, 7 failed. The failures are timeline virtualization/scroll scenarios, not port ownership or browser startup.
- Full Playwright E2E: repository Chromium and WebKit launched; 230 tests executed with 78 passed and 152 failed. Failures include stale fixture expectations, WebKit `Promise.withResolvers` helpers, transport-path assertions, terminal/timeline fixtures, and model-routing fixtures.
- Tailscale target: direct authenticated health/project requests to `100.97.224.96:4096` passed; registering the private origin through the isolated app was correctly rejected until the exact origin is present in `OPENCODE_ALLOWED_SERVERS`.
- Branch baseline: authoritative feature start was `e77c7a74134dd4a20e6b28a75e5c05a5504af2f`; `origin/main` was `918d6c51ad1e6d9fe653feba08879ec86bac4a34`; main was not modified.

Remaining acceptance work is environmental rather than a reason to weaken the runtime: use the connected backend and `TEMP_REPO` to run server/project/session isolation, reconnect/resync, interrupt/follow-up, terminal reuse, Git-backed review, reload, and mobile/WebKit flows, then attach Playwright and console/network evidence.
