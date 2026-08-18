# Authenticated OpenCode Runtime Chain Repair Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authenticated OpenCode server registration and the complete gateway-backed runtime chain reliable without turning normal connection failures into a fatal application error.

**Architecture:** The gateway registry owns credentials and one structured probe result. Registration, refresh, reconnect, and connection initialization consume that result; the browser consumes public server metadata and never stores passwords. Bootstrap is gated on `READY`, and each downstream layer exposes explicit loading, ready, empty, or error state.

**Tech Stack:** Bun, TypeScript, SolidJS, Vite, Node HTTP gateway, OpenCode v1/v2 HTTP/SSE APIs, Playwright/browser tests, systemd, Caddy.

**Spec:** User incident specification in the conversation dated 2026-08-18.

## Global Constraints

- Use `export OPENCODE_TEST_SERVER_URL='...'` for live testing; never commit private addresses or credentials.
- 401/403 must remain authentication failures, never protocol-unknown failures.
- Gateway credentials are the only credential source for proxied health, project, session, provider, model, prompt, event, and file requests.
- Registration may persist `REGISTERED`/`UNHEALTHY`, but only `READY` may enter normal app bootstrap.
- A connection failure must remain recoverable UI state and must not reject the application root.
- No false-success fallback may convert required operation failures into empty data.

### Task 1: Reproduce and record the live failure

**Files:**
- Inspect: `/etc/opencode.env`, `/etc/opencode-web-ui/opencode.env`, `/etc/systemd/system/opencode.service`, `/etc/systemd/system/opencode-proxy.service`
- Test: `packages/app/src/server/server-registry.test.ts`, `packages/app/src/server/proxy.test.ts`

- [ ] Export `OPENCODE_TEST_SERVER_URL` without printing credentials.
- [ ] Inspect the OpenCode service environment for username/password presence and record only username redacted/absent status.
- [ ] Run authenticated and unauthenticated `/global/health` and the current `/api/health` from the gateway host, recording status, JSON shape, and latency without secrets.
- [ ] Reproduce `POST /api/opencode/servers` through Caddy and capture the sanitized response/state transition.
- [ ] Trace the fatal protocol error from `detectServerProtocol`/connection initialization to the root error boundary.

### Task 2: Canonical structured gateway probe

**Files:**
- Modify: `packages/app/src/server/server-registry.ts`
- Modify: `packages/app/src/server/opencode-proxy.ts`
- Modify: `scripts/opencode-proxy.ts`
- Test: `packages/app/src/server/server-registry.test.ts`, `packages/app/src/server/proxy.test.ts`, `scripts/opencode-proxy.test.ts`

- [ ] Add failing tests for 200 v1, 200 v2, 401, 403, connection refused, timeout, malformed JSON, and unreachable classification.
- [ ] Implement `probeRegisteredServer(serverId)`/equivalent returning `{serverId, reachable, authenticated, healthy, protocol, state, latencyMs, error}`.
- [ ] Inject the registry username exactly when supplied; use the OpenCode-compatible default only when username is blank; never guess after 401.
- [ ] Reuse the canonical probe for registration, health, reconnect, and connection initialization.
- [ ] Add gateway tests proving proxied health and SSE/event requests use the same credential source.

### Task 3: Registration readiness and recoverable Add Server UI

**Files:**
- Modify: `packages/app/api/opencode/servers.ts`
- Modify: `packages/app/api/opencode/servers/[serverId]/health.ts`
- Modify: `packages/app/api/opencode/servers/[serverId]/reconnect.ts`
- Modify: `packages/app/src/components/dialog-select-server.tsx`
- Test: corresponding server-dialog and API tests

- [ ] Make non-ready registration return a durable unhealthy result with precise error metadata; it must not navigate/select as ready.
- [ ] Add `Retry`, `Edit`, and `Remove` recovery actions for unhealthy registrations.
- [ ] Add failing tests proving 401 registration remains manageable and never selects the server.
- [ ] Verify passwords are absent from public server payloads, browser storage, URLs, and diagnostics.

### Task 4: ConnectionManager and protocol failure containment

**Files:**
- Modify: `packages/app/src/context/server-sdk.tsx`
- Modify: `packages/app/src/context/server.tsx`
- Inspect/modify: `packages/app/src/utils/server-protocol.ts`, `packages/app/src/utils/server-health.ts`
- Test: connection manager, protocol, and context tests

- [ ] Add failing tests for connect rejection mapping to `AUTH_FAILED`/`UNHEALTHY` without root render rejection.
- [ ] Make gateway protocol metadata authoritative after `READY`; browser revalidation must go through the gateway.
- [ ] Ensure protocol Promise consumers receive stateful errors rather than unhandled fatal rejections.

### Task 5: Bootstrap gating and explicit downstream state

**Files:**
- Modify: `packages/app/src/context/global-sync/bootstrap.ts`
- Modify: `packages/app/src/context/global-sync/*`
- Inspect/modify: `packages/app/src/context/global-sync/utils.ts`
- Test: bootstrap, project, session, provider, and model tests

- [ ] Add a test proving projects/sessions/providers/models/references/agents/commands/MCP do not request before `READY`.
- [ ] Replace required-operation `catch(() => [])`/`{}`/`undefined` fallbacks with explicit error state and retry.
- [ ] Preserve genuine empty states only after successful responses.

### Task 6: Projects, project directory, existing sessions, and new sessions

**Files:**
- Inspect/modify: `packages/app/src/context/server.tsx`, `packages/app/src/pages/home/*`, session controllers, session SDK/context files
- Test: project/session/browser tests

- [ ] Verify `serverId`, project directory, and workspace stay attached through project open and bootstrap.
- [ ] Verify existing sessions list/open, metadata/messages, and event subscription.
- [ ] Gate new-session creation on ready provider/model state and verify returned session ownership.

### Task 7: Providers/models, prompt, SSE, and follow-up

**Files:**
- Inspect/modify: provider/model selectors, prompt submission, event/SSE adapters, session message state
- Test: provider/model/prompt/SSE/browser tests

- [ ] Verify provider/model loading, ready, empty, and error states with server/workspace scope.
- [ ] Trace exactly one prompt POST and record sanitized server/session/directory/provider/model/protocol/status metadata.
- [ ] Verify authenticated global event SSE, response event adaptation, visible assistant text, and follow-up prompt.

### Task 8: Recovery and live-loop validation

**Files:**
- Inspect: all runtime files and `docs/deployment/*`
- Test: browser E2E and live gateway checks

- [ ] Test bad auth → `AUTH_FAILED` → edit credentials → `READY`.
- [ ] Test OpenCode restart, Tailscale outage, reconnect, and refresh without fatal root error.
- [ ] Run the complete authenticated flow three consecutive times, stopping and fixing at the first failed boundary.
- [ ] Run targeted tests, gateway/registry/protocol/connection/bootstrap/session/provider/model/prompt/SSE tests, typecheck, E2E typecheck, browser E2E, production build, and `git diff --check`.
- [ ] Review the final diff for private IPs, usernames, passwords, tokens, authorization headers, and debug dumps before commit.
