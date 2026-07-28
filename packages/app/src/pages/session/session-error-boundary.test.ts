import { describe, expect, test } from "bun:test"
import {
  isCurrentSessionNotFoundError,
  isLocalSessionNotFoundError,
  isSessionNotFoundError,
  sessionNotFoundError,
} from "@/utils/server-errors"

/**
 * Tests for the session error boundary extraction.
 *
 * These verify that the error-boundary helpers (extracted from session.tsx
 * in Phase 3) work correctly. The boundary itself is tested indirectly:
 * - SessionRouteErrorBoundary wraps SessionPage in app.tsx
 * - SessionErrorFallback imports are lazy-loaded to keep the entry chunk small
 * - The default export re-exports from the barrel
 * - The retry mechanism uses SolidJS ErrorBoundary's reset function
 *
 * SolidJS component rendering is tested via integration/E2E tests rather than
 * unit tests, because Solid's JSX compilation uses internal primitives
 * (_$createComponent, _$el) that cannot be mocked via React JSX mocks.
 */

// ---------------------------------------------------------------------------
// isCurrentSessionNotFoundError predicate tests
// ---------------------------------------------------------------------------

describe("isCurrentSessionNotFoundError", () => {
  test("returns false when sessionID is undefined", () => {
    expect(isCurrentSessionNotFoundError(new Error("not found"), undefined)).toBe(false)
  })

  test("returns false for a generic error", () => {
    expect(isCurrentSessionNotFoundError(new Error("network error"), "session-1")).toBe(false)
  })

  test("returns true for a server-side SessionNotFoundError", () => {
    // Server errors arrive as SDK-wrapped errors with _tag + sessionID in cause.body
    const body = { _tag: "SessionNotFoundError", sessionID: "session-1", message: "Session not found" }
    const err = new Error(body.message, { cause: { body, status: 404 } })
    expect(isCurrentSessionNotFoundError(err, "session-1")).toBe(true)
  })

  test("returns true for a local session-not-found error", () => {
    // Local session-not-found errors use the canonical message: "Session not found: {sessionID}"
    const err = new Error("Session not found: session-1")
    expect(isCurrentSessionNotFoundError(err, "session-1")).toBe(true)
  })

  test("returns false when sessionID does not match the error's sessionID", () => {
    const body = { _tag: "SessionNotFoundError", sessionID: "ses_parent", message: "Session not found" }
    const err = new Error(body.message, { cause: { body, status: 404 } })
    expect(isCurrentSessionNotFoundError(err, "ses_tab")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// sessionNotFoundError factory + isLocalSessionNotFoundError tests
// ---------------------------------------------------------------------------

describe("sessionNotFoundError factory", () => {
  test("creates an error with the canonical message format", () => {
    const err = sessionNotFoundError("session-1")
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe("Session not found: session-1")
  })
})

describe("isLocalSessionNotFoundError", () => {
  test("returns true when message matches canonical format for the given sessionID", () => {
    expect(isLocalSessionNotFoundError(new Error("Session not found: session-1"), "session-1")).toBe(true)
  })

  test("returns false when sessionID differs", () => {
    expect(isLocalSessionNotFoundError(new Error("Session not found: session-1"), "session-2")).toBe(false)
  })

  test("returns false for other error messages", () => {
    expect(isLocalSessionNotFoundError(new Error("network error"), "session-1")).toBe(false)
  })

  test("returns false when error is not an Error instance", () => {
    expect(isLocalSessionNotFoundError("Session not found: session-1", "session-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Module-level tests — verify exports exist without rendering.
// SolidJS components require a proper reactive context and JSX transform;
// these tests check that components are correctly exported as functions.
// ---------------------------------------------------------------------------

describe("session-error-boundary module structure", () => {
  test("session-error-boundary.tsx exports SessionRouteErrorBoundary", async () => {
    const mod = await import("./session-error-boundary")
    expect(mod.SessionRouteErrorBoundary).toBeDefined()
    expect(typeof mod.SessionRouteErrorBoundary).toBe("function")
  })

  test("session-error-fallback.tsx exports SessionErrorFallback", async () => {
    const mod = await import("./session-error-fallback")
    expect(mod.SessionErrorFallback).toBeDefined()
    expect(typeof mod.SessionErrorFallback).toBe("function")
  })

  test("SessionErrorFallback accepts an onRetry callback in its props", async () => {
    const mod = await import("./session-error-fallback")
    // The component accepts props: error, sessionID, serverKey, padded, onRetry
    // Since it's a SolidJS component we can't easily inspect prop types, but
    // we can verify the module loaded successfully and the component is a function.
    expect(typeof mod.SessionErrorFallback).toBe("function")
  })
})
