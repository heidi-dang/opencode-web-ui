# Web UI Control Server Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Close the audited production hardening gaps while preserving the existing Bun/Hono, control-plane, managed-runtime, gateway, and Caddy architecture.

**Architecture:** Keep one Bun/Hono runtime behind loopback Caddy. Add security and resource-boundary enforcement at the existing unified middleware, backend destination, stream bridge, database client, diagnostics handler, and deployment-definition seams. No new backend runtime or proxy service is introduced.

**Tech Stack:** Bun, Hono, Node-compatible request/response adapters, SQLite, Bun test, GitHub Actions YAML, Caddy/systemd deployment templates.

**Spec:** User-provided production hardening task dated 2026-08-19.

## Global Constraints

- Do not redesign the unified Browser → Caddy → Bun/Hono → AgentBackendManager architecture.
- Never log or return credentials, Authorization, cookies, tokens, encryption keys, prompt contents, assistant contents, or uploaded data.
- Keep the standalone proxy optional/debug-only and never canonical for production.
- Preserve `idleTimeout: 0`, single managed runtime ownership, health deduplication, SSE, interrupt, model routing, and provider/session behavior.
- Every behavior change gets a failing regression test before implementation.

---

### Task 1: Production access boundary

**Files:**
- Modify: `packages/app/src/server/unified-runtime.ts`
- Modify: `packages/app/src/server/production-server.ts`
- Modify: `packages/app/src/server/control-plane-api.ts`
- Test: `packages/app/src/server/production-server.test.ts`
- Modify: `deploy/opencode.env.example`

**Interfaces:**
- `WEBUI_AUTH_MODE=basic` enables a configured Basic Auth boundary for public production requests.
- `WEBUI_AUTH_USERNAME` and `WEBUI_AUTH_PASSWORD_HASH` are server-only configuration values.
- Requests from local development remain unauthenticated when auth mode is unset.

- [ ] Write tests proving anonymous protected requests return 401, valid credentials pass, malformed credentials fail, and auth headers never enter logs.
- [ ] Run the focused production-server tests and confirm the new tests fail for the missing boundary.
- [ ] Implement the shared auth guard before control/gateway dispatch, with constant-time password verification and sanitized 401 responses.
- [ ] Keep SPA/API behavior unchanged when auth is disabled for local development.
- [ ] Run focused tests and typecheck.

### Task 2: Canonical DNS-aware SSRF policy

**Files:**
- Modify: `packages/app/src/server/backend/network.ts`
- Modify: `packages/app/src/server/server-registry.ts`
- Modify: `packages/app/src/server/opencode-proxy.ts`
- Test: `packages/app/src/server/backend/foundation.test.ts`
- Test: `packages/app/src/server/server-registry.test.ts`

**Interfaces:**
- `validateBackendDestination(endpoint, options)` returns a normalized URL after scheme, credential, fragment, allowlist, and DNS-result validation.
- Health and gateway callers use the same validator and manual redirect policy.

- [ ] Add failing tests for all private ranges, mixed DNS answers, hostname-to-private resolution, malformed URLs, credentials, and redirect rejection.
- [ ] Run the network tests and confirm the current hostname-only policy fails the DNS cases.
- [ ] Implement injectable DNS resolution for deterministic tests, rejecting any private result unless the exact configured origin is allowlisted.
- [ ] Reuse the validator at registration/update, health, reconnect, and gateway request construction.
- [ ] Run focused SSRF tests and verify Tailscale target remains allowed only by exact origin configuration.

### Task 3: Bounded production stream backpressure

**Files:**
- Modify: `packages/app/src/server/production-server.ts`
- Modify: `packages/app/src/server/opencode-proxy.ts`
- Test: `packages/app/src/server/production-server.test.ts`
- Test: `packages/app/src/server/unified-runtime.test.ts`

**Interfaces:**
- The Node response adapter exposes bounded queue state and emits `drain` after the Web `ReadableStream` consumer releases capacity.
- Gateway reads the upstream body only while capacity is available and aborts on cancellation.

- [ ] Add a deterministic slow-consumer test that forces `write()` false and proves upstream reads pause until `drain`.
- [ ] Add cancellation coverage while blocked on drain and assert listener/reader cleanup.
- [ ] Run the focused tests and observe the current always-true adapter fail.
- [ ] Implement a bounded high-water-mark queue using Web Streams backpressure without an unbounded buffer.
- [ ] Run focused stream tests, SSE tests, and production-server typecheck.

### Task 4: SQLite integrity and diagnostics identity

**Files:**
- Modify: `packages/app/src/server/control-plane/database/client.ts`
- Modify: `packages/app/src/server/client-diagnostics.ts`
- Modify: `packages/app/src/server/production-server.ts`
- Test: `packages/app/src/server/backend/foundation.test.ts`
- Test: `packages/app/src/server/client-diagnostics.test.ts`

**Interfaces:**
- Every control-plane SQLite connection enables foreign keys before use.
- Diagnostic client identity is derived only from validated trusted-proxy metadata; otherwise it uses a stable safe fallback that does not merge arbitrary forwarded identities.

- [ ] Add failing tests for `PRAGMA foreign_keys`, cascade deletion, independent client quotas, spoofed forwarding headers, and oversized/redacted payloads.
- [ ] Run focused database and diagnostics tests and confirm the current gaps.
- [ ] Enable `PRAGMA foreign_keys = ON` alongside existing WAL/synchronous/busy-timeout settings.
- [ ] Implement trusted-proxy-aware identity extraction with validated forwarded address handling and safe fallback bucketing.
- [ ] Run focused tests and full app unit tests.

### Task 5: CI and deployment hygiene

**Files:**
- Modify: `.github/workflows/ci.yml`
- Move: `deploy/opencode-proxy.service` to `deploy/debug/opencode-proxy.service`
- Modify: `deploy/debug/opencode-proxy.service`
- Modify: `deploy/opencode.env.example`

**Interfaces:**
- CI has unique YAML keys and explicit hardening gates for production-server, SSRF, backpressure, SQLite, auth, and official smoke tests.
- The standalone proxy service is visibly optional/debug-only and is not referenced by normal production deployment.

- [ ] Add a YAML parse/duplicate-key validation step and identify the duplicate `run` keys.
- [ ] Repair duplicate keys and add focused hardening test commands to CI without sleeps beyond existing backend readiness polling.
- [ ] Move and label the standalone service as debug/legacy-only without changing scripts used by tests.
- [ ] Validate YAML and deployment-template assertions locally.

### Task 6: Integrated verification and deployment

**Files:**
- No source changes unless a focused regression is discovered.

- [ ] Run root typecheck, E2E typecheck, DB check, build, unit, browser, E2E, and focused hardening tests.
- [ ] Commit each completed task separately and push `feat/web-ui-control-server` after each green focused gate.
- [ ] Deploy the exact final feature SHA to the existing Bun service and reload Caddy without changing the topology.
- [ ] Verify public auth, bootstrap, backend health, Vite guards, SSE endurance, managed runtime count, and logs.
- [ ] Run production outage/recovery, two-browser, restart, and follow-up acceptance; report physical iPhone Safari separately if not available.
