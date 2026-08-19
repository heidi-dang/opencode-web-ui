# Provider Catalog and Session Server Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Add Provider use the connected server's complete integration catalogue and make the existing Server Status preference reactively render the server status control in every session.

**Architecture:** Add a server-scoped supported-provider adapter over v2 `integration.list` and the v1 `provider.auth` compatibility endpoint, keeping integration capability data separate from the session model catalogue. Reuse the existing `StatusPopoverV2`/`StatusPopoverServerBody` components and wire the persisted `settings.visibility.status` signal to the server-scoped status trigger in both session layouts without adding polling.

**Tech Stack:** SolidJS, TanStack Solid Query, generated OpenCode v1/v2 clients, Bun tests, Playwright.

**Spec:** User request for the provider catalogue and Server Status fixes in the current conversation.

## Global Constraints

- Do not hardcode the full provider universe, private server data, credentials, tokens, or absolute production paths.
- Keep supported providers, connected providers, and available models as separate concepts.
- Preserve current v1/v2 adapters, Safari-safe transport, SSE/reconnect/resync, and Stop/Interrupt behavior.
- Loading and error states must not become a successful empty catalogue.
- Server Status must consume existing connection/health state and must not introduce a polling loop.

### Task 1: Establish failing contract tests

**Files:**
- Create: `packages/app/src/hooks/supported-provider-catalog.test.ts`
- Create: `packages/app/src/components/server-status-view.test.ts`
- Modify: `packages/app/src/hooks/supported-provider-catalog.ts` (created in Task 2)
- Modify: `packages/app/src/components/server-status-view.ts` (created in Task 4)

**Interfaces:**
- `normalizeSupportedProviderCatalog(input, connectedIds?)` returns a normalized provider map with capability methods and connected flags.
- `resolveServerStatusView(input)` returns a stable visible label/state from existing server health/connection data.

- [ ] **Step 1: Write tests for complete provider integration normalization.**

  Cover 80 supported integrations with only 3 connected, unknown icon metadata, ID/name search data, and malformed/error state handling.

- [ ] **Step 2: Write tests for server status view mapping.**

  Cover hidden visibility, READY, RECONNECTING, STATE_RESYNCING, DEGRADED, and UNHEALTHY labels.

- [ ] **Step 3: Run the focused tests and verify they fail for missing production contracts.**

  Run: `bun test --conditions=solid --preload packages/app/happydom.ts packages/app/src/hooks/supported-provider-catalog.test.ts packages/app/src/components/server-status-view.test.ts`

  Expected: FAIL because the new canonical adapters do not exist yet.

### Task 2: Implement the server-scoped supported-provider catalogue

**Files:**
- Create: `packages/app/src/hooks/supported-provider-catalog.ts`
- Modify: `packages/app/src/context/server-sdk.tsx` or `packages/app/src/context/server-sync.tsx` to expose one server-scoped query/refresh path
- Modify: `packages/app/src/utils/server-compat.ts` to isolate the v1 provider-auth adapter if needed
- Test: `packages/app/src/hooks/supported-provider-catalog.test.ts`

**Interfaces:**
- `SupportedProvider` contains `id`, `name`, `methods`, `connected`, and optional `connections`.
- `SupportedProviderCatalog` contains `status: "idle" | "loading" | "ready" | "empty" | "error"`, `providers: Map<string, SupportedProvider>`, and optional `error`.
- `normalizeSupportedProviderCatalog` accepts the authoritative v2 integration list or v1 auth map plus connected provider IDs.

- [ ] **Step 1: Add the minimal normalizer implementation required by the failing tests.**
- [ ] **Step 2: Add a server-scoped query using v2 `integration.list({ location })`.**
- [ ] **Step 3: Add the v1 adapter from `legacy.provider.auth()` and preserve method metadata.**
- [ ] **Step 4: Keep query keys scoped by stable server scope and directory/location.**
- [ ] **Step 5: Invalidate supported, connected, model, and directory provider queries after integration connection events.**
- [ ] **Step 6: Run provider catalogue tests and existing provider normalization tests.**

### Task 3: Wire Add Provider to the complete catalogue

**Files:**
- Modify: `packages/app/src/components/dialog-connect-provider.tsx`
- Modify: `packages/app/src/components/settings-v2/providers.tsx` if its loading/error state needs to expose the new catalogue
- Modify: `packages/app/src/components/settings-providers.tsx` if legacy settings uses the same picker
- Test: provider picker tests or `packages/app/src/components/dialog-connect-provider.test.tsx` if the repository’s component test pattern supports it

**Interfaces:**
- Picker rows consume `SupportedProviderCatalog.providers`, not `useProviders().all()`.
- Featured ordering remains a presentation-only partition over the complete row list.

- [ ] **Step 1: Add a failing picker assertion for an unconnected, non-featured provider.**
- [ ] **Step 2: Render all supported providers with generic fallback icon/name data.**
- [ ] **Step 3: Preserve search over ID and display name across popular and all-provider rows.**
- [ ] **Step 4: Expose loading, empty, error, and retry states explicitly.**
- [ ] **Step 5: Refresh the supported catalogue and model catalogue after successful provider connection.**
- [ ] **Step 6: Run focused provider tests and typecheck.**

### Task 4: Wire Server Status to the active session

**Files:**
- Create: `packages/app/src/components/server-status-view.ts`
- Modify: `packages/app/src/components/status-popover.tsx`
- Modify: `packages/app/src/components/session/session-header.tsx`
- Modify: `packages/app/src/pages/new-session/new-session-view.tsx` if its status slot uses the directory scope
- Test: `packages/app/src/components/server-status-view.test.ts`

**Interfaces:**
- `resolveServerStatusView` consumes the current server key, existing health record, and connection state; it performs no network requests.
- `StatusPopoverV2({ scope: "server" })` is the session server status control.

- [ ] **Step 1: Implement the tested status state mapping.**
- [ ] **Step 2: Make the existing server status popover consume the mapped state without adding polling.**
- [ ] **Step 3: Change both existing-session and new-session V2 status slots to render `scope="server"`.**
- [ ] **Step 4: Keep the `settings.visibility.status` accessor as the single reactive visibility source.**
- [ ] **Step 5: Verify server switching and connection transitions update the same control.**
- [ ] **Step 6: Run status tests and relevant session/settings tests.**

### Task 5: Browser and regression validation

**Files:**
- Modify/Create: existing provider/settings Playwright spec under `packages/app/e2e/` only if the repository has a matching fixture
- No production changes outside the provider/status surfaces above

- [ ] **Step 1: Run app typecheck and E2E typecheck.**
- [ ] **Step 2: Run focused provider, settings, connection, and session tests.**
- [ ] **Step 3: Run Chromium and WebKit browser coverage for Add Provider and Server Status, or document the exact environment blocker.**
- [ ] **Step 4: Run production build.**
- [ ] **Step 5: Run `git diff --check`, inspect the diff/stat, and verify no secrets/private deployment data were added.**
- [ ] **Step 6: Commit and push the repair branch only after the acceptance checks pass.**
