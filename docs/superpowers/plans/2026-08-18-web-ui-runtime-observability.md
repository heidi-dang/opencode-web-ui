# Web UI Runtime Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add redacted, correlated, bounded diagnostics to the unified Web UI runtime and deploy them enabled on `feat/web-ui-control-server` without changing business behavior.

**Architecture:** A small server logger will normalize levels, redact sensitive fields, serialize bounded JSON, and carry request context through the unified runtime. Existing control-plane, backend manager, adapter, gateway, SSE, and session operations will emit lifecycle events through that logger. The browser will send bounded error/API/SSE diagnostics to a rate-limited ingestion endpoint without including storage, credentials, prompt, or message data.

**Tech Stack:** Bun, TypeScript, Vite middleware, Node HTTP, SolidJS, SQLite control plane, systemd/journald.

**Spec:** User-approved runtime observability requirements in the conversation.

## Global Constraints

- Never log Authorization, cookies, passwords, tokens, APP_ENCRYPTION_KEY, credential payloads, prompt text, assistant content, uploaded files, or sensitive query values.
- Preserve existing backend runtime ownership, health deduplication, gateway routing, SSE streaming, and disabled standalone proxy behavior.
- Keep high-volume event metadata at TRACE only and keep healthy polling at DEBUG.
- Validate and rate-limit browser telemetry; telemetry failures must not recursively generate telemetry.
- Deploy only `feat/web-ui-control-server`; do not merge `main`.

### Task 1: Logging foundation and correlation

**Files:**
- Create: `packages/app/src/server/observability/logger.ts`
- Create: `packages/app/src/server/observability/logger.test.ts`
- Create: `packages/app/src/server/observability/request-context.ts`
- Modify: `packages/app/src/server/unified-runtime.ts`
- Modify: `packages/app/src/server/proxy.ts`

- [ ] Add failing tests for level filtering, JSON output, redaction, bounded serialization, and request-ID propagation.
- [ ] Implement logger configuration from existing environment conventions plus `WEBUI_LOG_LEVEL` and `WEBUI_LOG_FORMAT`.
- [ ] Implement recursive redaction by sensitive key and sensitive URL query removal; preserve safe error name/message/stack only.
- [ ] Add validated incoming request ID handling, generated IDs, and response header emission.
- [ ] Emit startup/ready/shutdown metadata without secret values.
- [ ] Run the logger tests and commit `feat(server): add structured runtime diagnostics`.

### Task 2: Control-plane and backend runtime instrumentation

**Files:**
- Modify: `packages/app/src/server/control-plane-api.ts`
- Modify: `packages/app/src/server/services/bootstrap-service.ts`
- Modify: `packages/app/src/server/services/backend-service.ts`
- Modify: `packages/app/src/server/backend/manager.ts`
- Modify: `packages/app/src/server/backend/circuit-breaker.ts`
- Modify: `packages/app/src/server/control-plane/database/*`

- [ ] Add lifecycle logs for bootstrap, backend mutations, invalid legacy records, runtime create/reuse/invalidate, health deduplication, and circuit transitions.
- [ ] Thread request context into control-plane operations without changing their return values or runtime ownership.
- [ ] Keep healthy polling at DEBUG and promote state changes/errors to INFO/WARN/ERROR.
- [ ] Add focused tests proving secret-free lifecycle fields and health deduplication behavior.
- [ ] Commit `feat(server): instrument control-plane operations`.

### Task 3: Gateway, adapter, EventHub, and session instrumentation

**Files:**
- Modify: `packages/app/src/server/opencode-proxy.ts`
- Modify: `packages/app/src/server/backend/adapters/opencode/adapter.ts`
- Modify: `packages/app/src/server/backend/event-hub.ts`
- Modify: `packages/app/src/context/server-sdk.tsx`
- Modify: session/prompt server integration files discovered during audit.

- [ ] Emit safe gateway start/upstream/response/abort/error lifecycle events with route and status but no body/header secrets.
- [ ] Emit adapter operation and prompt/session/project/provider/model lifecycle events with safe IDs/counts.
- [ ] Emit SSE/EventHub lifecycle events, subscriber cleanup, overflow, slow-subscriber, and listener-error diagnostics; never log token payloads.
- [ ] Add correlation fields to server-side lifecycle entries wherever request context is available.
- [ ] Commit `feat(server): instrument backend gateway runtime`.

### Task 4: Browser diagnostics and ingestion endpoint

**Files:**
- Create: `packages/app/src/server/client-diagnostics.ts`
- Create: `packages/app/src/server/client-diagnostics.test.ts`
- Create: `packages/app/src/utils/client-diagnostics.ts`
- Modify: `packages/app/src/server/unified-runtime.ts`
- Modify: `packages/app/src/app.tsx`
- Modify: shared browser fetch/SSE error paths identified during audit.

- [ ] Add failing tests for payload rejection, field validation, redaction, size limits, rate limits, and recursion protection.
- [ ] Implement `POST /api/debug/client-events` behind `WEBUI_CLIENT_ERROR_LOGGING` with bounded request body and per-client rate limiting.
- [ ] Install guarded `window.onerror`, `unhandledrejection`, ErrorBoundary, bootstrap/API failure, and SSE failure reporting.
- [ ] Use safe pathname/route and IDs only; never serialize localStorage, prompt, message, cookies, or full URLs.
- [ ] Commit `feat(app): report browser runtime diagnostics`.

### Task 5: Production configuration and deployment

**Files:**
- Modify: managed deployment/systemd environment files only if repository-controlled.
- Add: deployment documentation only if needed to record logging and journald policy.

- [ ] Verify bounded journald retention and disk usage before enabling debug logs.
- [ ] Build and run root typecheck, E2E typecheck, DB check, focused tests, unit/browser suites, production build, and diff check.
- [ ] Push the final feature SHA and deploy only that SHA to the unified Web UI service with standalone proxy disabled.
- [ ] Verify public health, target backend health, service/Caddy state, deployed SHA, and log configuration.
- [ ] Emit `MANUAL_DEBUG_SESSION_START` only after those checks pass, including timestamp, deployed SHA, and target backend ID.
- [ ] Leave `WEBUI_LOG_LEVEL=debug` and client telemetry enabled; report journal commands and any unchanged baseline failures.
