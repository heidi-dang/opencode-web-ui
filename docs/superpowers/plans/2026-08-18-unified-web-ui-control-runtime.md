# Unified Web UI Control Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Web UI server own the control-plane and compatibility gateway path in normal local/runtime operation, with one managed backend runtime per backend ID and no mandatory standalone proxy process.

**Architecture:** The Vite Web UI server handles `/api/bootstrap` and backend-control routes by calling the existing control-plane API module, and handles compatibility routes through the existing OpenCode proxy module. `AgentBackendManager` remains the sole owner of backend adapter/circuit/event runtime instances. The standalone `scripts/opencode-proxy.ts` remains an optional adapter for split deployments and debugging.

**Tech Stack:** Bun, Vite middleware, Node HTTP streams, TypeScript, Bun SQLite, Bun test.

**Spec:** User request for post-rebase Web UI control-server integration and single backend runtime ownership.

## Global Constraints

- Do not merge to `main`.
- Do not deploy production.
- Do not hardcode backend hosts, ports, credentials, provider IDs, or private paths.
- Preserve the current v1/v2 compatibility gateway and browser same-origin routing.
- Keep the standalone proxy available as optional split/debug mode.
- Do not create a second backend registry, adapter, circuit breaker, or EventHub implementation.

---

### Task 1: Baseline and reproduce the mandatory-proxy failure

**Files:**
- Read: `packages/app/vite.config.ts`
- Read: `packages/app/src/server/control-plane-api.ts`
- Read: `packages/app/src/server/proxy.ts`
- Read: `packages/app/src/server/opencode-proxy.ts`
- Test: `packages/app/src/server/proxy.test.ts`

**Interfaces:**
- `handleControlPlaneRequest(req, res, pathname)` owns control-plane JSON routes.
- `handleOpenCodeProxy(req, res, next?)` owns compatibility/gateway routes.

- [ ] Run the branch/type/build/database baselines using the package scripts in `package.json`.
- [ ] Start the Web UI without the standalone proxy and request `/api/bootstrap` and `/api/opencode/servers`; record the exact failure and confirm whether the Vite middleware returns `CONTROL_SERVER_UNAVAILABLE`.
- [ ] Start the standalone proxy only as a control comparison; confirm the same requests succeed through port `8787`.
- [ ] Verify `git diff --check` and keep the working tree limited to the plan until the reproduction is captured.

### Task 2: Mount existing handlers directly in the Web UI server

**Files:**
- Modify: `packages/app/vite.config.ts`
- Test: `packages/app/src/server/proxy.test.ts` or a new focused Vite middleware test beside the configuration if the repository test harness supports it.

**Interfaces:**
- The Vite middleware must call `server.ssrLoadModule("./src/server/control-plane-api.ts")` for control routes and `server.ssrLoadModule("./src/server/proxy.ts")` for compatibility routes.
- It must pass the original Node request/response objects and call `next()` only for non-API routes or after a handler explicitly declines the request.

- [ ] Add a failing focused test or executable middleware harness proving that `/api/bootstrap` and `/api/opencode/servers` are served without port `8787`.
- [ ] Replace the unconditional `forwardToControlServer` path with direct handler dispatch while retaining the existing route split and error response behavior.
- [ ] Ensure request bodies and streaming responses remain Node streams; do not buffer SSE or route browser traffic directly to OpenCode.
- [ ] Run the focused handler tests with the standalone proxy stopped and confirm control, project/session proxy, streaming, and interrupt requests use the same Web UI origin.

### Task 3: Make backend runtime ownership and probe deduplication explicit

**Files:**
- Modify: `packages/app/src/server/backend/manager.ts`
- Modify: `packages/app/src/server/backend/adapters/opencode/adapter.ts` only if lifecycle ownership requires it.
- Modify: `packages/app/src/server/backend/event-hub.ts` only if the manager needs to expose existing metrics/cleanup.
- Test: `packages/app/src/server/backend/foundation.test.ts`

**Interfaces:**
- `agentBackendManager.get(id)` returns the single adapter instance for `id`.
- `agentBackendManager.health(id, recovery?, signal?)` must share an in-flight probe for the same backend unless the caller explicitly starts a recovery probe.
- `agentBackendManager.invalidate(id)` must disconnect and remove the adapter, circuit, in-flight operations, and event state owned by that backend.

- [ ] Add a failing test that concurrent `get(id)` calls return the same backend instance and do not construct duplicate adapters.
- [ ] Add a failing test that concurrent normal health calls produce one upstream probe and all callers receive the result.
- [ ] Implement only the missing manager-owned in-flight maps and cleanup; preserve circuit recovery semantics and do not deduplicate mutations.
- [ ] Add metrics/test accessors sufficient to assert runtime count, active health probes, and per-backend subscription count without exposing credentials.
- [ ] Run backend foundation tests and verify invalidation removes the runtime and its metrics.

### Task 4: Verify multi-client and end-to-end runtime behavior

**Files:**
- Test: `packages/app/src/server/backend/foundation.test.ts`
- Test: `packages/app/src/utils/control-plane.test.ts`
- Test: `scripts/opencode-proxy.test.ts`
- Add/modify: a repository-supported integration/browser test fixture only if existing test infrastructure cannot exercise two clients.
- Docs: `docs/web-ui-control-server.md`

**Interfaces:**
- The test fixture uses an environment-provided backend endpoint and a deterministic local OpenCode-compatible server; no production values are committed.
- The expected browser-facing route is the Web UI origin `/api/*`.

- [ ] Test two clients sharing one backend ID: one database record, one manager runtime, bounded health probes, independent downstream subscribers.
- [ ] Test backend deletion/update invalidates subscriptions, cache, circuit, and in-flight state before a fresh runtime is created.
- [ ] Test standalone-proxy-stopped flow through bootstrap, server registration/listing, health, project/session proxy, prompt/stream, and interrupt.
- [ ] Document the unified local/runtime path and the standalone script’s optional split/debug role, including the intentional browser-SDK compatibility stream path.
- [ ] Run typecheck, database check, focused unit/integration tests, app build, and `git diff --check`.

### Task 5: Commit and push each confirmed chunk

**Files:**
- Modify only files changed by the preceding tasks.

**Interfaces:**
- Each commit contains one independently testable fix and is pushed to `origin/feat/web-ui-control-server`.

- [ ] Review `git diff`, `git diff --cached`, and `git diff --check` before each commit.
- [ ] Commit the direct Web UI handler integration with a focused `feat(server): ...` message.
- [ ] Commit runtime ownership/deduplication only if tests prove it was missing.
- [ ] Push each commit and verify local HEAD equals `origin/feat/web-ui-control-server`.
- [ ] Do not merge or deploy.
