# Premium Session UI Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore premium session UI polish and settings integrations from the historical commits while preserving the current stable OpenCode runtime.

**Architecture:** Presentation components consume current synchronized session/server/provider state. Runtime state transitions remain in the existing sync, event, execution, and interrupt layers. Provider Settings reads the canonical connected-server catalog; Server Status uses the existing persisted visibility setting and current metadata.

**Tech Stack:** SolidJS, TypeScript, V2 UI primitives, Bun tests, Playwright Chromium/WebKit, Vite.

**Spec:** `docs/superpowers/specs/2026-08-18-premium-ui-restoration-design.md`

## Global Constraints

- Do not cherry-pick the historical commits.
- Do not change the current connection, SSE, reconciliation, Stop/Interrupt, or provider error state machines.
- Use `session.tokens` and `session.cost` published by the current SessionRunner/model pricing path.
- Do not add duplicate health/model polling or eager highlighter loading.
- Do not commit credentials, registry data, logs, or generated artifacts.

### Task 1: Restore safe streaming presentation

**Files:**
- Modify: `packages/app/src/pages/session/composer/session-composer-region.tsx`
- Modify: `packages/app/src/pages/session/composer/streaming-status-bar.tsx`
- Create: `packages/app/src/pages/session/composer/session-progress-ring.tsx`
- Modify: `packages/app/src/pages/session/composer/session-todo-dock.tsx`
- Modify: `packages/app/src/index.css`

- [ ] Add a V2-only progress-ring slot using defensive current Todo status handling.
- [ ] Bind status/glow visibility to current working and interrupting state, not historical event assumptions.
- [ ] Restore todo entrance, completion, and active glow classes with reduced-motion fallbacks.
- [ ] Add responsive status/todo sizing without changing the prompt or Stop control structure.
- [ ] Add focused pure tests for progress calculation and status visibility.

### Task 2: Restore layout and branding details

**Files:**
- Modify: `packages/app/src/components/prompt-input-v2.tsx`
- Modify: `packages/session-ui/src/v2/components/prompt-input/index.tsx`
- Modify: `packages/app/src/components/titlebar.tsx`
- Modify: `packages/app/src/components/server/server-row.tsx`
- Modify: `packages/app/src/components/settings-v2/servers.tsx`

- [ ] Port only missing shrink/min-width constraints around current controls.
- [ ] Keep current Stop/Interrupt button semantics and accessibility labels intact.
- [ ] Restore intentional HEIDI presentation text only where current channel UI supports it.
- [ ] Display provider/model metadata only from existing health/server state.

### Task 3: Complete Provider Settings catalog

**Files:**
- Modify: `packages/app/src/components/settings-v2/providers.tsx`
- Modify: `packages/app/src/hooks/use-providers.ts`
- Test: `packages/app/src/hooks/provider-catalog.test.ts`

- [ ] Expose the full server-supported catalog separately from connected providers.
- [ ] Preserve connected/configured indicators and existing auth/disconnect behavior.
- [ ] Ensure server/directory changes do not leak catalogs across scopes.
- [ ] Add tests for unconnected supported providers, connected indicators, and errors.

### Task 4: Wire reactive Server Status

**Files:**
- Modify: `packages/app/src/components/session/session-header.tsx`
- Modify: `packages/app/src/components/status-popover.tsx` or add a focused status component if needed.
- Test: `packages/app/src/components/session/session-header.test.tsx` or the existing settings/status test location.

- [ ] Trace the existing persisted `showStatus` preference through the session route.
- [ ] Render current server/protocol/health/latency/provider/model/stream metadata reactively.
- [ ] Verify toggling the setting shows/hides status without reload and persists across refresh.
- [ ] Avoid new polling; consume existing server and sync state.

### Task 5: Validate runtime preservation

**Files:**
- Test: focused streaming/todo/provider/settings tests and existing interrupt/runtime tests.

- [ ] Run app and E2E typechecks.
- [ ] Run focused UI/provider/settings/interrupt tests.
- [ ] Run Chromium and WebKit regression flows, including Stop and follow-up prompt.
- [ ] Run responsive browser checks at mobile and desktop widths.
- [ ] Run production build and `git diff --check`.
