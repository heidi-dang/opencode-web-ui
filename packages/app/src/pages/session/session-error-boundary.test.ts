import { beforeAll, describe, expect, mock, test } from "bun:test"
import {
  isCurrentSessionNotFoundError,
  isLocalSessionNotFoundError,
  isSessionNotFoundError,
  sessionNotFoundError,
} from "@/utils/server-errors"

// ---------------------------------------------------------------------------
// Minimal SolidJS-compatible JSX runtime for DOM rendering in tests.
// SolidJS transforms JSX into calls that bun maps to react/jsx-dev-runtime.
// This implementation creates real DOM elements so we can test rendering
// and interaction (button clicks, etc.) without the full Vite build.
// ---------------------------------------------------------------------------
function jsxDEV(type: any, props: Record<string, unknown> | null, _key?: string) {
  if (typeof type === "string") {
    const el = document.createElement(type)
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "children") {
          if (typeof v === "string" || typeof v === "number") {
            el.textContent = String(v)
          } else if (v instanceof Node) {
            el.appendChild(v)
          } else if (Array.isArray(v)) {
            for (const child of v) {
              if (child instanceof Node) el.appendChild(child)
            }
          }
        } else if (k === "class" || k === "className") {
          el.className = String(v)
        } else if (k === "classList") {
          // SolidJS classList object — skip in testing
        } else if (k.startsWith("on")) {
          const event = k.slice(2).toLowerCase()
          el.addEventListener(event, v as EventListener)
        } else if (k === "style" && typeof v === "object" && v !== null) {
          Object.assign(el.style, v)
        } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          el.setAttribute(k, String(v))
        }
      }
    }
    return el
  }
  // Function component: call with props
  if (typeof type === "function") {
    return type(props ?? {})
  }
  return null
}

// ---------------------------------------------------------------------------
// Helper: create a mock translation function that returns the key itself.
// This lets us assert on language keys in rendered output.
// ---------------------------------------------------------------------------
function mockTranslator() {
  return { t: (key: string) => key }
}

// ---------------------------------------------------------------------------
// isCurrentSessionNotFoundError predicate tests
// These import from the real @/utils/server-errors module (no JSX).
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
// Module-level tests for SessionRouteErrorBoundary & SessionErrorFallback.
// These use mock.module to intercept SolidJS JSX dependencies (which bun's
// test runner cannot natively compile without a Vite/SolidJS plugin).
// ---------------------------------------------------------------------------

// Register JSX runtime mocks at the top level so they are in place before
// any module resolution. Bun may cache JSX transforms across test files;
// we cover both the modern jsxDEV transform AND the legacy createElement
// transform (which bun falls back to when running the full suite).
mock.module("react/jsx-dev-runtime", () => ({ jsxDEV }))
mock.module("react/jsx-runtime", () => ({ jsx: jsxDEV, jsxs: jsxDEV }))
mock.module("react", () => ({ createElement: jsxDEV, default: { createElement: jsxDEV } }))
// Global React fallback: bun may cache JSX compilation across test workers.
// If another worker compiled a .tsx file with React.createElement before our
// mock took effect, the cached module expects React to be a global.
;(globalThis as Record<string, unknown>).React = { createElement: jsxDEV }

let SessionRouteErrorBoundary: unknown
let SessionErrorFallback: unknown

beforeAll(async () => {

  // Mock context modules that SessionErrorFallback depends on.
  // Each returns the minimum shape needed for the component to render.
  mock.module("@/context/language", () => ({
    useLanguage: mockTranslator,
  }))

  mock.module("@/context/server", () => ({
    ServerConnection: { Key: { make: (v: string) => v } as { make: (v: string) => string } & string },
    serverName: () => "Mock Server",
    useServer: () => ({ key: "srv", list: [] }),
  }))

  mock.module("@/context/tabs", () => ({
    useTabs: () => ({
      ready: () => true,
      store: [],
      removeSessionTab: () => {},
    }),
  }))

  mock.module("@/context/settings", () => ({
    useSettings: () => ({ general: { newLayoutDesigns: () => true } }),
  }))

  // Mock UI components that use JSX internally.
  mock.module("@opencode-ai/ui/v2/button-v2", () => ({
    ButtonV2: (props: Record<string, unknown>) => {
      const btn = document.createElement("button")
      btn.textContent = (props.children as string) ?? "Button"
      if (props.onClick) btn.addEventListener("click", props.onClick as EventListener)
      if (props.icon) btn.setAttribute("data-icon", props.icon as string)
      return btn
    },
  }))

  mock.module("@/pages/error", () => ({
    ErrorPage: (props: Record<string, unknown>) => {
      const div = document.createElement("div")
      div.textContent = `ErrorPage: ${String(props.error)}`
      return div
    },
  }))

  const [boundaryMod, fallbackMod] = await Promise.all([
    import("./session-error-boundary"),
    import("./session-error-fallback"),
  ])
  SessionRouteErrorBoundary = boundaryMod.SessionRouteErrorBoundary
  SessionErrorFallback = fallbackMod.SessionErrorFallback
})

describe("SessionRouteErrorBoundary module", () => {
  test("exports a function component", () => {
    expect(SessionRouteErrorBoundary).toBeDefined()
    expect(typeof SessionRouteErrorBoundary).toBe("function")
  })
})

describe("SessionErrorFallback module", () => {
  test("exports a function component", () => {
    expect(SessionErrorFallback).toBeDefined()
    expect(typeof SessionErrorFallback).toBe("function")
  })
})

// ---------------------------------------------------------------------------
// Rendering and interaction tests for SessionErrorFallback
// ---------------------------------------------------------------------------

describe("SessionErrorFallback rendering", () => {
  test("renders retry button when onRetry callback is provided", () => {
    let retryCalled = false

    const el = (SessionErrorFallback as Function)({
      error: new Error("transient error"),
      onRetry: () => {
        retryCalled = true
      },
    }) as Element | null

    expect(el).toBeTruthy()
    expect(el!.nodeType).toBe(Node.ELEMENT_NODE)

    const retryButton = el!.querySelector("button")
    expect(retryButton).not.toBeNull()
    expect(retryButton!.getAttribute("data-icon")).toBe("arrow-clockwise")
  })

  test("clicking the retry button invokes the onRetry callback", () => {
    let retryCalled = false

    const el = (SessionErrorFallback as Function)({
      error: new Error("transient error"),
      onRetry: () => {
        retryCalled = true
      },
    }) as Element

    const retryButton = el.querySelector("button")!
    retryButton.click()

    expect(retryCalled).toBe(true)
  })

  test("renders close-tab button for session-not-found errors instead of retry", () => {
    const err = new Error("Session not found: session-1")
    const el = (SessionErrorFallback as Function)({
      error: err,
      sessionID: "session-1",
      onRetry: () => {},
    }) as Element

    expect(el).toBeTruthy()

    // Should show a close-tab button (xmark-small icon), not a retry button
    const buttons = el.querySelectorAll("button")
    expect(buttons.length).toBeGreaterThan(0)

    const closeButton = el.querySelector('button[data-icon="xmark-small"]')
    expect(closeButton).not.toBeNull()
  })

  test("falls back to ErrorPage when onRetry is absent and it is not a not-found error", () => {
    const el = (SessionErrorFallback as Function)({
      error: new Error("fatal error"),
      // No onRetry — fallback path
    }) as Element

    expect(el).toBeTruthy()
    expect(el.textContent).toContain("ErrorPage:")
  })
})
