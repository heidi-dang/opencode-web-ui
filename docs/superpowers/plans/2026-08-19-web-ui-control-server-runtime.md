# Web UI Control Server Runtime Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the feature branch’s control-plane API, production Bun/Hono runtime, Caddy deployment, and real OpenCode browser journey use one tested contract and one managed backend runtime.

**Architecture:** Keep the existing AgentBackendManager and observability layers, normalize all control-plane health responses at the HTTP boundary, and add a production Bun server that shares the existing request handlers with Vite development mode. Caddy proxies only to the loopback Bun server; the standalone proxy remains optional and stopped.

**Tech Stack:** Bun, Hono, Vite/Solid development adapter, Node HTTP-compatible control/gateway handlers, Drizzle/SQLite control plane, Caddy, Playwright Chromium/WebKit.

**Spec:** Current user task: production Web UI control-server integration and runtime journey repair.

## Global Constraints

- Preserve the feature branch history and merge `origin/main` without rewriting it.
- Keep the control-plane database authoritative; browser `server.v4` is migration/UI state only.
- Keep one managed runtime per backend ID and retain health/runtime/event deduplication.
- Never log credentials, authorization, cookies, tokens, encryption keys, prompts, assistant content, or uploaded data.
- Keep the standalone proxy optional and stopped in normal production operation.
- Do not merge into `main`.

### Task 1: Reconcile the feature branch with current main

**Files:**
- Modify: conflict files reported by Git during the merge only.
- Test: affected focused tests after each logical conflict group.

- [ ] Create and push a safety ref for the current feature SHA.
- [ ] Merge `origin/main` with a non-fast-forward merge, preserving control-plane, model/provider, session, transport, and observability changes.
- [ ] Run typecheck and focused tests for each resolved conflict group.
- [ ] Commit and push the reconciliation before functional changes.

### Task 2: Canonicalize control-plane HTTP contracts

**Files:**
- Modify: `packages/app/src/server/control-plane-api.ts`, `packages/app/api/opencode/servers/[serverId]/health.ts`, `packages/app/api/opencode/servers/[serverId]/reconnect.ts`, `packages/app/api/opencode/servers/[serverId].ts` as applicable.
- Modify: `packages/app/src/utils/control-plane.ts`, `packages/app/src/components/settings-servers.tsx`, `packages/app/src/components/settings-v2/dialog-server-v2.tsx` as applicable.
- Test: control-plane API and browser/server-management tests.

- [ ] Add a typed serializer returning top-level `state`, `protocol`, `reachable`, `authenticated`, `healthy`, `latencyMs`, `checkedAt`, and optional `error` alongside `server`.
- [ ] Use the serializer for GET/POST health, reconnect, and registration probe responses.
- [ ] Make registration readiness use `payload.ready`, `payload.server.state`, and `payload.probe.healthy`, never `probe.state`.
- [ ] Make health/reconnect/edit consumers parse the canonical response and report contract errors explicitly.
- [ ] Add failing contract tests, make them pass, and commit the focused fix.

### Task 3: Add the production Bun application server

**Files:**
- Create or modify: the repository’s canonical Bun/Hono application entrypoint discovered from the existing unified runtime handlers.
- Modify: `packages/app/package.json`, root `package.json`, systemd/deployment templates, and Caddy template if tracked.
- Test: production-mode API/static/SSE smoke tests.

- [ ] Reuse the existing control-plane and compatibility gateway handlers in a Bun/Hono server.
- [ ] Serve `packages/app/dist`, hashed assets, index fallback, and no-cache HTML without exposing Vite modules.
- [ ] Preserve streaming, abort, backpressure, request correlation, and structured logs.
- [ ] Make `serve` run this server while `dev` remains Vite.
- [ ] Add startup configuration validation and graceful termination.
- [ ] Add tests for `/`, `/assets`, `/api/bootstrap`, `/api/opencode`, SPA fallback, and blocked Vite dev paths.
- [ ] Commit and push the production-runtime chunk.

### Task 4: Align deployment definitions

**Files:**
- Modify: tracked Caddy/systemd deployment definitions only.
- Test: Caddy validation and local production-mode smoke.

- [ ] Point Caddy at the loopback Bun server with streaming flush behavior.
- [ ] Remove obsolete `:8787` standalone-proxy instructions from canonical deployment templates.
- [ ] Keep the standalone proxy disabled and optional.
- [ ] Commit and push deployment-definition changes.

### Task 5: Run complete validation and deploy exact SHA

**Files:**
- No source changes unless a failing journey produces a new root-cause regression.

- [ ] Run root/app typechecks, DB check, build, unit/browser tests, API/gateway tests, and Chromium/WebKit.
- [ ] Deploy the exact pushed feature SHA to the VPS and verify SHA parity.
- [ ] Validate the target backend through Caddy → Bun → control plane → managed runtime → OpenCode.
- [ ] Exercise add/edit/reconnect/disable/enable/delete, project/session/provider/model/prompt/SSE/interrupt/follow-up, reload, restart, outage/recovery, and two-browser flows.
- [ ] Inspect the acceptance window logs and resolve every unexplained application error.
- [ ] Emit a fresh debug marker only after the clean journey passes; do not merge to main.
