# Autonomous Workspace Implementation

## Focused defect-closure gate — 2026-08-20 (authoritative)

This is the current gate after the timeline, terminal, interrupt, reconnect, and
remote-registration closure pass. It supersedes the historical records below.
The focused blockers are closed, but the broad application E2E matrix still has
repository-controlled failures, so this is not a 100% production-acceptance claim.

| Area | Result | Evidence |
| --- | --- | --- |
| Branch/source | PASS | Started at `9e78a6e5ab2ee0a716327c7af2e405cf1b11a9a9`; `origin/main` is `918d6c51ad1e6d9fe653feba08879ec86bac4a34`; main was not modified. |
| Encrypted local runtime | PASS | Tests used an ephemeral 32-byte `APP_ENCRYPTION_KEY` through the environment; plaintext mode was not used. |
| Browser binaries | PASS | Playwright `1.59.1`; Chromium and WebKit launch successfully. |
| Timeline virtualization/scroll | PASS | Focused Chromium/WebKit timeline suite: 12/12; final stability analyzer: 23/23. |
| Terminal focus/visibility | PASS | Focused terminal regression suite: 8/8 across Chromium/WebKit; selected terminal tabs are required to be visible and non-zero-sized before focus assertions. |
| Interrupt/reconnect | PASS (focused) | Session interrupt/transport lifecycle suite: 18/18 across Chromium/WebKit, including stop, follow-up, heartbeat, close, error, replay, and resync coverage. |
| Remote backend registration | PASS | `srv_2f9736e138ce8bde` registered through the app with exact `OPENCODE_ALLOWED_SERVERS=http://100.97.224.96:4096`; health was READY/v2/reachable/authenticated/healthy. |
| Unit/browser | PASS — BASELINE WARNING | Unit tests: 932/932. Browser tests: 50 pass plus the identical Solid cleanup failure reproduced on clean `origin/main`. |
| Full E2E | FAIL | Fresh 230-test matrix: 161 passed, 69 failed, 0 skipped. Remaining failures are grouped in review/file fixtures, prompt/model fixture expectations, request-dock route assertions, WebKit CDP-only coverage, terminal tab fixtures, and smoke timeline fixtures. |
| Full stability | PASS | Fresh prebuilt-serve run: analyzer 23/23 and browser phase 88/88. |
| Vercel red checks | BLOCKED — AUTH REQUIRED | `opencode-web-ui` and `opencode-web-ui-ct` remain red, but authenticated Vercel deployment logs are unavailable; no branch-code cause is proven. |
| Readiness score | 8.6/10 | Focused workspace blockers pass, but the full E2E gate is not green. Do not claim 9.5/10 or 100% closure until the 69 failures are resolved/classified at their owning layers. |

The focused test changes are harness/regression fixes only. They do not restore a
global workspace bridge, alter the session-scoped controller, disable timeline
virtualization, change PTY ownership, weaken the exact-origin allowlist, or add
production debug hooks.

## Historical acceptance record — superseded

This section supersedes earlier provisional acceptance notes below. It records the
current `encryption-key-configuration` gate without treating mock-only coverage as
real-backend evidence.

| Area | Result | Evidence |
| --- | --- | --- |
| Branch/source | PASS | Feature started at `e77c7a74134dd4a20e6b28a75e5c05a5504af2f`; `origin/main` was `918d6c51ad1e6d9fe653feba08879ec86bac4a34`; main was not modified. |
| Encrypted local runtime | PASS | Acceptance processes used an ephemeral 32-byte `APP_ENCRYPTION_KEY` supplied only through the environment. |
| Browser binaries | PASS | Repository Playwright `1.59.1`; Chromium and WebKit installed from the repository package and launch-smoked. |
| Real local OpenCode | PASS | Authenticated v2 server on `127.0.0.1:4096`; real session prompt streamed through the gateway and rendered. |
| Remote OpenCode reachability | PASS | `100.97.224.96:4096` returned authenticated `/global/health` and `/project` responses; private-origin registration requires the configured `OPENCODE_ALLOWED_SERVERS` allowlist. |
| Workspace mount | PASS | Conversation, Session lineage, Timeline, Changes, and Context views mounted in the real session route. |
| Git-backed diff | PASS | A real prompt changed one tracked acceptance file; Git status/diff and the workspace review agreed. |
| Typecheck/build/database | PASS | Root typecheck, E2E typecheck, DB check, and production build passed. |
| Unit/browser | PASS — BASELINE WARNING | 932 unit tests passed. Browser tests reported 50 passed and the unchanged Solid cleanup failure; the same failure was reproduced on clean `origin/main`. |
| Targeted E2E | PASS | The repaired control-plane/registry fixture group passed 15/15 in Chromium; workspace accessibility smoke passed in Chromium and WebKit. |
| Full E2E | FAIL — 78 PASS / 152 FAIL (pre-helper rerun) | The complete 230-test Chromium/WebKit matrix executed with the isolated fixture DB and configurable port before the WebKit deferred-helper correction; no tests were skipped. The post-correction targeted terminal/history subset was 3 PASS / 3 FAIL, so a clean final full-matrix result is not claimed. |
| Full stability | FAIL — 81 PASS / 7 FAIL | Analyzer 23/23 passed; the prebuilt production server and 88-test Chromium/WebKit browser phase executed. Two Chromium and five WebKit failures remain in timeline virtualization/scroll scenarios. |
| Vercel red checks | BLOCKED — EXTERNAL | GitHub exposes deployment URLs but Vercel project logs require authenticated Vercel access; no branch-code cause is proven. |

No visible production telemetry is fabricated. Unsupported agent hierarchy, context
limits, inferred pricing, token speed, and destructive review mutations remain
explicitly unavailable. The standalone proxy is not part of the acceptance runtime.

## Architecture

The autonomous workspace is an opt-in view of the existing session route. It does not own an SDK client, SSE connection, message reducer, review engine, or terminal/PTY subsystem.

```text
OpenCode ServerSDK event stream
  -> existing server-sync/session reconciliation
  -> active Page/session owner
  -> SessionWorkspaceController (bounded derived timeline)
  -> workspace selectors/contracts
  -> v0 presentation components
```

The controller is created directly by the mounted session page for `(serverID, directory, sessionID)` and is disposed with that Solid session owner. It does not require a nested context provider, which avoids evaluating the session page before the provider boundary exists during draft-to-session navigation. A reconnect/resync clears transient timeline entries; authoritative session, message, review, model, and terminal state remains owned by the existing application stores.

## Verified data flow

| Surface | OpenCode/application source | Adapter | UI status |
| --- | --- | --- | --- |
| Session lineage | normalized session records and `Session.parentID` | `sessionLineageTree` | DERIVED; parent/child lineage only |
| Timeline | normalized `ServerSDK.event.listen` events | `createSessionWorkspaceController` | LIVE/DERIVED; explicit allowlist, stable IDs, bounded retention |
| Review/changes | existing session/VCS diff state | `workspaceChangeFromDiff` | LIVE/DERIVED read-only projection |
| Model/usage | authoritative assistant message metadata | `contextUsageFromMessage` | LIVE when provided; missing values are UNAVAILABLE |
| Terminal | existing `TerminalProvider` and `TerminalPanel` components | session route composition | LIVE; no second PTY implementation |
| Layout | browser preference only | versioned `workspace-preferences.ts` | PERSISTED preference; never runtime truth |

The current session is marked `current`; other same-directory records are `derived`. Missing parents, duplicate IDs, and cycles are shown as `unavailable`. The UI does not claim delegated agents, agent progress, context limits, pricing, token speed, or execution timers unless authoritative data is added later.

## Controller and event safety

`runtime-bridge.ts` now contains the session-scoped controller implementation only; it no longer publishes a process-global workspace buffer or listener set. `server-sync.tsx` remains the authoritative event subscription and does not publish workspace-specific global state.

Only explicitly supported event types become timeline entries. Official event IDs are preserved. Id-less events use a scoped, domain-specific fallback only where the event has a stable request/call identity; repeatable progress events also require an upstream timestamp. Prompt text, deltas, reasoning text, tool payloads, command output, file contents, and error details are not copied into workspace state.

The controller deduplicates replay IDs, orders by timestamp with stable ID tie-breaking, suppresses unchanged notifications, evicts deterministically at a bounded limit, and ignores events after disposal. A session switch or server resync disposes/resets the prior controller.

## Presentation and persistence

The existing Night Owl styling, responsive overflow, focus rings, reduced-motion classes, and v0 panel layout are preserved. New visible strings use the typed locale dictionaries.

The workspace toggle is opt-in and disabled by default. `workspace-preferences.ts` stores only a strict version-1 schema: enabled state, selected workspace view, expanded panel IDs, bounded expanded lineage session IDs, and the context tab (`usage` or the real-event `activity` summary). Its key is scoped to server ID and directory, not session ID. Invalid JSON, versions, fields, duplicate/unsafe lineage IDs, or storage failures fall back to the safe conversation preference without blocking startup. Lineage rows read the live scoped expansion signal, so controlled updates render immediately and persist without making persisted IDs runtime truth.

## Capability status

- LIVE: session conversation, normalized event subscription, server/project/session scope, VCS/session diff projection, provider/model/token/cost fields when returned, existing terminal.
- DERIVED: session lineage tree and allowlisted timeline categories.
- UNAVAILABLE: unsupported agent delegation semantics, context limits, context percentage, pricing not returned by OpenCode, token speed, arbitrary tool/output details, and destructive review mutations.
- DEVELOPMENT ONLY: fixture data used by isolated tests.
- FUTURE: authoritative agent hierarchy and server-confirmed review mutations if OpenCode exposes safe APIs.

## Tests

Focused controller, lifecycle, contract, preference, i18n, and browser presentation tests cover scope isolation, identity/dedupe, ordering, replay/reset/disposal, bounded retention, lineage failure states, safe metrics/diffs, invalid persistence, and localized rendering. The full app unit, browser, stability, typecheck, build, and real-backend E2E gates remain the final acceptance work for this branch.

Frontend phase: the mounted workspace keeps conversation primary and adds a responsive, touch-scrollable view switcher for lineage, timeline, changes/review, and context. Active and failed timeline cards are emphasized without fabricated progress; review rows expose long paths through accessible labels and titles; unavailable telemetry remains intentional.

## Historical connected acceptance matrix — superseded

| Area | Result | Evidence |
| --- | --- | --- |
| Connected backend | PASS (local) | Real authenticated OpenCode 1.18.18 at `127.0.0.1:4096`, protocol v2, project `/`; the requested Tailscale target refused TCP during this run. |
| Mounted workspace | PASS | Production Bun server on an isolated port; real session prompt rendered and workspace toggle mounted without route error. |
| Live streaming | PASS | Real prompt admitted through the gateway and assistant response rendered. |
| Timeline / lineage / Usage-Activity tabs | PASS (smoke) | Workspace views rendered from the connected session; no console/page errors. Extended burn-in remains environment-dependent. |
| Diff/review | PASS (local) | A disposable Git project was edited by a real prompt; Git status/diff and the workspace review agreed on the modified file. |
| Terminal | NOT CLOSED | Existing PTY remains covered by targeted fixtures, but the full connected acceptance did not produce clean terminal evidence. |
| Interrupt / reconnect | NOT CLOSED | Real prompt/SSE streaming passed; a clean controlled interrupt/reconnect burn-in is not proven by the completed matrix. |
| Persistence / reload | PASS (smoke) | Fresh-context bootstrap no longer opens the setup modal before the registry settles; workspace navigation remained available after reload. |
| Chromium / WebKit / mobile | PASS (smoke) | Connected real prompt/workspace flows passed in Chromium and WebKit; phone/tablet/landscape viewports had no horizontal overflow. WebKit reported only the existing ResizeObserver lifecycle warning. |
| Stability / CI | FAIL / classified | `test:stability` completed the analyzer (23/23) and prebuilt browser phase (81/88). Seven timeline virtualization/scroll cases failed. Vercel red checks require authenticated project access for logs. |

Historical note: the earlier 928-test/Chromium-missing report is superseded by the final record above. The current run used repository Playwright 1.59.1 with installed Chromium/WebKit, an isolated control-plane DB, and an explicit port.

Final-gate rerun from `e77c7a74134dd4a20e6b28a75e5c05a5504af2f`: root typecheck, E2E typecheck, DB check, and production build passed; the app unit suite passed 932/932; the browser suite reported 50 passed plus the identical Solid cleanup failure on clean `origin/main`. The pre-helper full E2E matrix executed 230 tests with 78 passed and 152 failed; no tests were skipped. The WebKit deferred helper was then replaced with a repository-local implementation and its focused subset ran 3/6; the three remaining failures are terminal focus/visibility assertions. Full stability executed its analyzer (23/23) and prebuilt browser phase (81/88), with seven timeline virtualization/scroll failures. Chromium and WebKit binaries launch successfully. The remaining E2E/stability failures are recorded as acceptance blockers rather than hidden behind a green smoke result.
