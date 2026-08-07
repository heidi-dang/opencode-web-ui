# Todo Live Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make same-length todo status updates observable by the session composer lifecycle.

**Architecture:** Add a small pure todo signature helper in the composer state module. Use that signature as the reactive effect dependency while preserving the existing server event and todo store paths.

**Tech Stack:** SolidJS, TypeScript, Bun tests.

## Global Constraints

- Change only the todo synchronization path and its regression coverage.
- Preserve existing dismissal and V1/V2 refresh behavior.
- No new dependencies.

### Task 1: Regression coverage

**Files:**
- Modify: `packages/app/src/pages/session/composer/session-composer-state.test.ts`
- Modify: `packages/app/src/pages/session/composer/session-composer-state.ts`

**Interfaces:**
- Produces: `todoSignature(todos)` returning a deterministic string that changes when todo content, status, priority, or order changes.

- [ ] **Step 1: Write the failing test**

Add a test importing `todoSignature` and assert that two lists with the same length but different statuses have different signatures.

- [ ] **Step 2: Run the focused test**

Run: `bun test --preload ./happydom.ts ./src/pages/session/composer/session-composer-state.test.ts`

Expected: FAIL because `todoSignature` is not exported yet.

- [ ] **Step 3: Implement the minimal signature helper**

Export a helper that joins each todo's content, status, and priority in order with a delimiter that cannot be confused with JSON structure by using `JSON.stringify` on the mapped tuples.

- [ ] **Step 4: Make the lifecycle effect depend on the signature**

Replace the effect dependency tuple's length-only todo input with the signature while retaining count, done, and live values used by the transition logic.

- [ ] **Step 5: Run focused verification**

Run the same test command. Expected: the pure todo assertions pass; if the existing client-only router error remains, report it separately.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck` from `packages/app`.

Expected: PASS with no new diagnostics.
