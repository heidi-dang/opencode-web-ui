# Autonomous Workspace Implementation

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

## Connected acceptance matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Connected backend | PASS (local) | Real authenticated OpenCode 1.18.18 at `127.0.0.1:4096`, protocol v2, project `/`; the requested Tailscale target refused TCP during this run. |
| Mounted workspace | PASS | Production Bun server on an isolated port; real session prompt rendered and workspace toggle mounted without route error. |
| Live streaming | PASS | Real prompt admitted through the gateway and assistant response rendered. |
| Timeline / lineage / Usage-Activity tabs | PASS (smoke) | Workspace views rendered from the connected session; no console/page errors. Extended burn-in remains environment-dependent. |
| Diff/review | PENDING | No safe repository-backed change was available in the `/`/No Git test project. |
| Terminal | PENDING | Existing PTY was not exercised in the no-Git project. |
| Interrupt / reconnect | PENDING | Requires a long-running real generation or controlled network interruption. |
| Persistence / reload | PASS (smoke) | Fresh-context bootstrap no longer opens the setup modal before the registry settles; workspace navigation remained available after reload. |
| Chromium / WebKit / mobile | PASS (smoke) | Connected real prompt/workspace flows passed in Chromium and WebKit; phone/tablet/landscape viewports had no horizontal overflow. WebKit reported only the existing ResizeObserver lifecycle warning. |
| Stability / CI | PARTIAL / classified | Visual stability unit tests passed (23/23); Playwright stability requires its synthetic fixture page and did not start against the production route. Full `test:stability` also exceeds the local 120s web-server timeout because the build takes ~11m33s. Vercel red checks require authenticated project access for logs. |
