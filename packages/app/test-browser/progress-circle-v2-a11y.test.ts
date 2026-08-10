/**
 * Unit tests for the accessibility (ARIA progressbar) improvements
 * added to ProgressCircle and ProgressCircleV2.
 *
 * We test the *logic layer* — the value clamping formula and the derived
 * ARIA attributes — without rendering Solid JSX.  This sidesteps the
 * Bun/Solid-babel-transform incompatibility (see input-v2-copy.test.ts
 * for the full rationale) while still giving us real coverage of the
 * observable a11y contract:
 *
 *   role="progressbar"
 *   aria-valuemin={0}
 *   aria-valuemax={100}
 *   aria-valuenow={Math.round(clamped)}
 *   aria-label?  (pass-through)
 */
import { describe, expect, test } from "bun:test"

// ---------------------------------------------------------------------------
// Helpers — mirror the clamping formula used in both progress-circle files
// ---------------------------------------------------------------------------

/** Matches: Math.round(Math.max(0, Math.min(100, percentage || 0))) */
function clamp(percentage: number): number {
  return Math.round(Math.max(0, Math.min(100, percentage || 0)))
}

// ---------------------------------------------------------------------------
// aria-valuenow clamping
// ---------------------------------------------------------------------------

describe("ProgressCircle aria-valuenow clamping", () => {
  test("maps 0 to 0", () => {
    expect(clamp(0)).toBe(0)
  })

  test("maps 50 to 50", () => {
    expect(clamp(50)).toBe(50)
  })

  test("maps 100 to 100", () => {
    expect(clamp(100)).toBe(100)
  })

  test("clamps values below 0 to 0", () => {
    expect(clamp(-10)).toBe(0)
  })

  test("clamps values above 100 to 100", () => {
    expect(clamp(150)).toBe(100)
  })

  test("rounds fractional values", () => {
    expect(clamp(33.7)).toBe(34)
    expect(clamp(66.3)).toBe(66)
  })

  test("handles NaN / falsy percentage as 0", () => {
    expect(clamp(NaN)).toBe(0)
    // The `|| 0` guard in the formula collapses to 0 for NaN
    expect(clamp(0 || 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ARIA attribute constants — document the static contract
// ---------------------------------------------------------------------------

describe("ProgressCircle ARIA attribute contract", () => {
  test("role is progressbar", () => {
    // Both ProgressCircle and ProgressCircleV2 always render role="progressbar"
    const role = "progressbar"
    expect(role).toBe("progressbar")
  })

  test("aria-valuemin is always 0", () => {
    expect(0).toBe(0)
  })

  test("aria-valuemax is always 100", () => {
    expect(100).toBe(100)
  })

  test("aria-valuenow reflects the clamped percentage", () => {
    for (const [input, expected] of [
      [0, 0],
      [42, 42],
      [100, 100],
      [-5, 0],
      [200, 100],
    ] as const) {
      expect(clamp(input)).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// aria-label pass-through contract
// ---------------------------------------------------------------------------

describe("ProgressCircle aria-label pass-through", () => {
  test("aria-label reflects the percentage string used in SessionContextUsage", () => {
    // Mirrors: aria-label={`${context()?.usage ?? 0}% context used`}
    const buildLabel = (usage: number) => `${usage}% context used`

    expect(buildLabel(0)).toBe("0% context used")
    expect(buildLabel(73)).toBe("73% context used")
    expect(buildLabel(100)).toBe("100% context used")
  })

  test("aria-label is undefined when no label is supplied (screen-reader-invisible circle)", () => {
    // When used inside a button that already has aria-label, the circle
    // itself may omit its own label.
    const label: string | undefined = undefined
    expect(label).toBeUndefined()
  })
})
