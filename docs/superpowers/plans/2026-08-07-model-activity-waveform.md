# Model Activity Waveform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the streaming status dot with a theme-aware ECG signal that traverses the available status-bar space and responds continuously to real model event cadence.

**Architecture:** Keep activity detection in useModelActivity, isolate cadence-to-motion policy in a pure profile module, and render one stable two-layer SVG whose CSS variables drive compositor-friendly motion. The waveform component owns the flexible signal track and telemetry slot so pulse timing can drive a subtle endpoint glow without duplicate activity subscriptions.

**Tech Stack:** SolidJS, TypeScript, inline SVG, CSS custom properties/keyframes, Bun tests, Playwright, Vite production benchmarks.

## Global Constraints

- Prioritize stability, simplicity, and performance in that order.
- Record a production session-timeline benchmark before changing session UI and compare it after implementation.
- Add every behavioral test first and observe the expected failure before production code.
- Do not ship or edit the supplied raster photographs.
- Do not add dependencies, canvas animation, JavaScript animation loops, per-frame layout measurement, or per-SSE-event DOM creation.
- Preserve SSE batching, todo latency, status-bar height, accessibility announcements, and horizontal overflow behavior.
- Reduced motion stops waveform travel and telemetry glow while preserving a visible state-colored signal.
- Browser plugin is unavailable in the current environment; use repository Playwright with the existing system-Chrome fallback and record this in QA.

## File Structure

- Create packages/app/src/pages/session/composer/model-activity-waveform-profile.ts for pure motion policy.
- Create packages/app/src/pages/session/composer/model-activity-waveform-profile.test.ts for policy tests.
- Create packages/app/src/pages/session/composer/model-activity-waveform.tsx for the smart SVG component and telemetry slot.
- Create packages/app/src/pages/session/composer/model-activity-waveform.css for geometry, motion, endpoint glow, and reduced motion.
- Delete model-activity-heartbeat.tsx and model-activity.css after all imports move.
- Modify streaming-status-bar.tsx and index.css for desktop/mobile placement.
- Modify the timeline fixture to support live session.updated telemetry.
- Create session-model-activity-waveform.spec.ts and update session-mobile-streaming-ui.spec.ts.

---

### Task 1: Capture the Required Production Baseline

**Files:**
- Read: packages/app/AGENTS.md
- Read: packages/app/e2e/performance/timeline/session-timeline-benchmark.spec.ts
- Output outside repo: /tmp/model-waveform-baseline.log

**Interfaces:**
- Consumes: the existing production performance harness.
- Produces: baseline initial-content, completion, long-task count/time, and pending-render metrics.

- [ ] **Step 1: Confirm the starting point**

Run:

~~~bash
git status -sb
git log -2 --oneline
~~~

Expected: the approved design and plan commits are the only commits ahead of origin/main, with no unstaged product files.

- [ ] **Step 2: Run the production baseline**

From packages/app:

~~~bash
TIMELINE_MINIMAL=1 PLAYWRIGHT_WORKERS=1 bunx playwright test --config e2e/performance/playwright.config.ts e2e/performance/timeline/session-timeline-benchmark.spec.ts | tee /tmp/model-waveform-baseline.log
~~~

Expected: PASS and a BENCHMARK record with non-null metrics. If bundled Chromium cannot launch, use a temporary config outside the repository pointing to /usr/bin/google-chrome; do not alter tracked configuration.

- [ ] **Step 3: Record exact baseline values**

Copy initial-content latency, completion latency, long-task count, long-task total, pending renders, row replacement, and markdown replacement values into execution notes without rounding.

### Task 2: Test and Implement Continuous Activity Profiles

**Files:**
- Create: packages/app/src/pages/session/composer/model-activity-waveform-profile.test.ts
- Create: packages/app/src/pages/session/composer/model-activity-waveform-profile.ts

**Interfaces:**
- Consumes: ModelActivityState and EWMA milliseconds.
- Produces:

~~~ts
export type ModelActivityWaveformProfile = {
  durationMs: number
  amplitude: number
  glow: number
  moving: boolean
  tone: "accent" | "warning" | "danger" | "muted"
}

export function modelActivityWaveformProfile(
  state: ModelActivityState,
  ewmaMs: number,
  reducedMotion?: boolean,
): ModelActivityWaveformProfile
~~~

- [ ] **Step 1: Write failing cadence and clamp tests**

~~~ts
import { describe, expect, test } from "bun:test"
import { modelActivityWaveformProfile } from "./model-activity-waveform-profile"

describe("modelActivityWaveformProfile", () => {
  test("turns faster cadence into quicker, taller, brighter motion", () => {
    const fast = modelActivityWaveformProfile("active-fast", 250)
    const slow = modelActivityWaveformProfile("active-slow", 1_800)
    expect(fast.durationMs).toBeLessThan(slow.durationMs)
    expect(fast.amplitude).toBeGreaterThan(slow.amplitude)
    expect(fast.glow).toBeGreaterThan(slow.glow)
    expect(fast).toMatchObject({ moving: true, tone: "accent" })
  })

  test("clamps cadence outside the supported range", () => {
    expect(modelActivityWaveformProfile("active-fast", -1)).toEqual(
      modelActivityWaveformProfile("active-fast", 250),
    )
    expect(modelActivityWaveformProfile("active-slow", 99_999)).toEqual(
      modelActivityWaveformProfile("active-slow", 1_800),
    )
  })
})
~~~

- [ ] **Step 2: Run and verify RED**

~~~bash
bun --cwd packages/app test src/pages/session/composer/model-activity-waveform-profile.test.ts
~~~

Expected: FAIL because the profile module does not exist.

- [ ] **Step 3: Add failing state and reduced-motion cases**

~~~ts
test.each([
  ["waiting-tool", "warning", true],
  ["waiting-input", "warning", true],
  ["stalled", "warning", true],
  ["error", "danger", false],
  ["disconnected", "danger", false],
  ["idle", "muted", false],
  ["completed", "muted", false],
] as const)("maps %s to %s with moving=%s", (state, tone, moving) => {
  expect(modelActivityWaveformProfile(state, 900)).toMatchObject({ tone, moving })
})

test("reduced motion retains active tone but stops travel", () => {
  expect(modelActivityWaveformProfile("active-fast", 250, true)).toMatchObject({
    tone: "accent",
    moving: false,
  })
})
~~~

- [ ] **Step 4: Implement the minimal profile**

~~~ts
import type { ModelActivityState } from "./activity-config"

export type ModelActivityWaveformProfile = {
  durationMs: number
  amplitude: number
  glow: number
  moving: boolean
  tone: "accent" | "warning" | "danger" | "muted"
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rounded = (value: number) => Math.round(value * 1_000) / 1_000

export function modelActivityWaveformProfile(
  state: ModelActivityState,
  ewmaMs: number,
  reducedMotion = false,
): ModelActivityWaveformProfile {
  const cadence = clamp(Number.isFinite(ewmaMs) ? ewmaMs : 1_800, 250, 1_800)
  const energy = 1 - (cadence - 250) / 1_550
  const active = {
    durationMs: Math.round(600 + (1 - energy) * 1_200),
    amplitude: rounded(0.72 + energy * 0.38),
    glow: rounded(0.42 + energy * 0.48),
    moving: !reducedMotion,
    tone: "accent" as const,
  }
  if (state === "active-fast" || state === "active-slow") return active
  if (state === "waiting-tool" || state === "waiting-input") {
    return { durationMs: 2_400, amplitude: 0.62, glow: 0.42, moving: !reducedMotion, tone: "warning" }
  }
  if (state === "stalled") {
    return { durationMs: 3_400, amplitude: 0.48, glow: 0.24, moving: !reducedMotion, tone: "warning" }
  }
  if (state === "error" || state === "disconnected") {
    return { durationMs: 0, amplitude: 0.58, glow: 0.48, moving: false, tone: "danger" }
  }
  return { durationMs: 0, amplitude: 0.52, glow: 0.2, moving: false, tone: "muted" }
}
~~~

- [ ] **Step 5: Verify GREEN and regression safety**

~~~bash
bun --cwd packages/app test src/pages/session/composer/model-activity-waveform-profile.test.ts
bun --cwd packages/app run test:unit
~~~

Expected: all focused and app unit tests PASS.

- [ ] **Step 6: Commit**

~~~bash
git add packages/app/src/pages/session/composer/model-activity-waveform-profile.ts packages/app/src/pages/session/composer/model-activity-waveform-profile.test.ts
git commit -m "Add model activity waveform profiles"
~~~

### Task 3: Add Failing Rendered Regressions

**Files:**
- Modify: packages/app/e2e/performance/timeline-stability/fixture.ts
- Create: packages/app/e2e/regression/session-model-activity-waveform.spec.ts
- Modify: packages/app/e2e/regression/session-mobile-streaming-ui.spec.ts

**Interfaces:**
- Adds sessionUpdated(info: Session): TimelineEvent to the shared fixture.
- Asserts future selectors model-activity-waveform, model-activity-waveform-track, and model-activity-waveform-signal.

- [ ] **Step 1: Extend the fixture**

Add "session.updated" to TimelinePayload and:

~~~ts
export function sessionUpdated(info: Session) {
  return event("session.updated", { info })
}
~~~

Run bun --cwd packages/app run typecheck:e2e. Expected: PASS.

- [ ] **Step 2: Write the failing desktop test**

Create session-model-activity-waveform.spec.ts:

~~~ts
import { expect, test } from "@playwright/test"
import { partDelta, session, sessionUpdated, setupTimeline } from "../performance/timeline-stability/fixture"

test("carries live activity from the working phrase into telemetry", async ({ page }) => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))

  const timeline = await setupTimeline(page, {
    settings: { newLayoutDesigns: true },
    sessions: [session({ tokens: undefined, cost: 0 })],
  })
  const status = page.locator('[data-component="streaming-status-bar"]')
  const phrase = status.locator(".status-text-verbose")
  const waveform = status.locator('[data-component="model-activity-waveform"]')
  const track = waveform.locator('[data-slot="model-activity-waveform-track"]')
  const initialHeight = await status.evaluate((element) => element.getBoundingClientRect().height)

  await expect(phrase).toBeVisible()
  await expect(waveform).toBeVisible()
  await expect(track).toBeVisible()
  await expect(waveform.locator(".streaming-status-telemetry")).toHaveCount(0)
  await expect(waveform.locator(".heartbeat-indicator")).toHaveCount(0)

  await timeline.send(partDelta("prt_assistant_text", "activity"))
  await expect(waveform).toHaveAttribute("data-state", /active-/)
  await timeline.send(
    sessionUpdated(
      session({ tokens: { input: 1_200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ),
  )

  const telemetry = waveform.locator(".streaming-status-telemetry")
  await expect(telemetry).toBeVisible()
  await expect(telemetry.locator(".streaming-token-usage")).toContainText("1,500")
  const geometry = await status.evaluate((element) => {
    const phrase = element.querySelector<HTMLElement>(".status-text-verbose")!
    const track = element.querySelector<HTMLElement>('[data-slot="model-activity-waveform-track"]')!
    const telemetry = element.querySelector<HTMLElement>(".streaming-status-telemetry")!
    return {
      phraseRight: phrase.getBoundingClientRect().right,
      trackLeft: track.getBoundingClientRect().left,
      trackRight: track.getBoundingClientRect().right,
      telemetryLeft: telemetry.getBoundingClientRect().left,
      height: element.getBoundingClientRect().height,
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  expect(geometry.phraseRight).toBeLessThanOrEqual(geometry.trackLeft)
  expect(geometry.trackRight).toBeLessThanOrEqual(geometry.telemetryLeft)
  expect(Math.abs(geometry.height - initialHeight)).toBeLessThanOrEqual(1)
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport)
  expect(errors).toEqual([])
})
~~~

- [ ] **Step 3: Write failing mobile and reduced-motion tests**

Append:

~~~ts
test("gives the waveform the mobile status-label space", async ({ page }) => {
  await setupTimeline(page, {
    viewport: { width: 390, height: 844 },
    settings: { newLayoutDesigns: true },
    sessions: [
      session({
        cost: 1.2345,
        tokens: { input: 7_000_000, output: 100_000, reasoning: 951, cache: { read: 0, write: 0 } },
      }),
    ],
  })
  const status = page.locator('[data-component="streaming-status-bar"]')
  const waveform = status.locator('[data-component="model-activity-waveform"]')
  await expect(status.locator(".status-text-verbose")).toBeHidden()
  await expect(status.locator(".status-text-compact")).toBeHidden()
  await expect(waveform).toBeVisible()
  await expect(waveform.locator(".streaming-token-usage")).toContainText("7.1M")
  await expect(waveform.locator(".streaming-cost")).toBeHidden()
  expect(
    await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    })),
  ).toEqual({ viewport: 390, document: 390 })
})

test("renders a static state-colored signal for reduced motion", async ({ page }) => {
  await setupTimeline(page, {
    reducedMotion: true,
    settings: { newLayoutDesigns: true },
    sessions: [
      session({ tokens: { input: 1_200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ],
  })
  const waveform = page.locator('[data-component="model-activity-waveform"]')
  await expect(waveform).toHaveAttribute("data-motion", "static")
  await expect(waveform).toHaveAttribute("data-tone", "accent")
  const animations = await waveform.evaluate((element) => ({
    signal: getComputedStyle(
      element.querySelector<SVGPathElement>('[data-slot="model-activity-waveform-signal"]')!,
    ).animationName,
    telemetry: getComputedStyle(element.querySelector<HTMLElement>(".streaming-status-telemetry")!).animationName,
  }))
  expect(animations).toEqual({ signal: "none", telemetry: "none" })
})
~~~

Update session-mobile-streaming-ui.spec.ts by replacing the old model-activity-heartbeat assertion with:

~~~ts
const waveform = status.locator('[data-component="model-activity-waveform"]')
await expect(waveform).toBeVisible()
await expect(waveform.locator('[data-slot="model-activity-waveform-track"]')).toBeVisible()
await expect(status.locator(".status-text-compact")).toBeHidden()
~~~

- [ ] **Step 4: Verify RED**

~~~bash
PLAYWRIGHT_WORKERS=1 bunx playwright test e2e/regression/session-model-activity-waveform.spec.ts e2e/regression/session-mobile-streaming-ui.spec.ts
~~~

Expected: FAIL because waveform selectors do not exist and the dot remains. Use the existing temporary system-Chrome configuration if bundled Chromium is unsupported.

### Task 4: Render and Style the Responsive ECG Signal

**Files:**
- Create: packages/app/src/pages/session/composer/model-activity-waveform.tsx
- Create: packages/app/src/pages/session/composer/model-activity-waveform.css
- Delete: packages/app/src/pages/session/composer/model-activity-heartbeat.tsx
- Delete: packages/app/src/pages/session/composer/model-activity.css
- Modify: packages/app/src/pages/session/composer/streaming-status-bar.tsx
- Modify: packages/app/src/index.css

**Interfaces:**
- Produces ModelActivityWaveform(props: ParentProps<{ sessionID: string }>).
- Accepts telemetry as children so timing variables cascade to the pill.
- Emits data-component, data-state, data-tone, data-motion, and stable data-slot selectors.

- [ ] **Step 1: Create the smart component**

Use useModelActivity, createMediaQuery("(prefers-reduced-motion: reduce)"), and modelActivityWaveformProfile. Move the existing translated fallback behavior into these helpers before deleting the old component:

~~~ts
const formatTime = (ms: number) => {
  const seconds = Math.floor(ms / 1_000)
  if (seconds < 1) return "< 1s"
  if (seconds < 60) return seconds + "s"
  return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s"
}

const statusLabel = createMemo(() => {
  const current = activity.state()
  let label = language.t("session.status.heartbeat." + current)
  if (!label || label.startsWith("session.status")) {
    const fallback = {
      "active-fast": "Thinking rapidly",
      "active-slow": "Processing",
      "waiting-tool": "Waiting for tool",
      "waiting-input": "Waiting for input",
      stalled: "Stalled",
      error: "Error",
      disconnected: "Disconnected",
      completed: "Completed",
      idle: "Idle",
    } satisfies Record<ModelActivityState, string>
    label = fallback[current]
  }
  if (["active-fast", "active-slow", "stalled", "waiting-tool"].includes(current)) {
    return label + " (" + formatTime(activity.timeSinceLastActivity()) + " since last activity)"
  }
  return label
})
~~~

Render this stable SVG geometry:

~~~tsx
const path = "M0 12 H14 L20 8 L27 17 L35 12 H45 L51 2 L59 22 L67 7 L75 17 L83 12 H100"

<div
  class="model-activity-waveform"
  data-component="model-activity-waveform"
  data-state={activity.state()}
  data-tone={profile().tone}
  data-motion={profile().moving ? "active" : "static"}
  style={
    "--wave-duration:" + profile().durationMs + "ms;" +
    "--wave-amplitude:" + profile().amplitude + ";" +
    "--wave-glow:" + profile().glow + ";" +
    "--wave-color:" + tone()
  }
  role="status"
  aria-label={statusLabel()}
  title={statusLabel()}
>
  <div data-slot="model-activity-waveform-track" aria-hidden="true">
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" focusable="false">
      <g class="model-activity-waveform-lines">
        <path class="model-activity-waveform-rail" d={path} pathLength="100" />
        <path class="model-activity-waveform-trail" d={path} pathLength="100" />
        <path data-slot="model-activity-waveform-signal" d={path} pathLength="100" />
      </g>
    </svg>
  </div>
  {props.children}
</div>
~~~

- [ ] **Step 2: Add waveform CSS**

Implement:

~~~css
.model-activity-waveform {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  gap: 8px;
  color: var(--wave-color);
}
[data-slot="model-activity-waveform-track"] {
  flex: 1 1 auto;
  min-width: 24px;
  height: 22px;
  overflow: hidden;
}
[data-slot="model-activity-waveform-track"] svg { display: block; width: 100%; height: 100%; }
.model-activity-waveform-lines {
  transform-box: fill-box;
  transform-origin: center;
  transform: scaleY(var(--wave-amplitude));
}
.model-activity-waveform-rail,
.model-activity-waveform-trail,
[data-slot="model-activity-waveform-signal"] {
  fill: none;
  stroke: currentColor;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.model-activity-waveform-rail { stroke-width: 1; opacity: 0.16; }
.model-activity-waveform-trail {
  stroke-width: 1.5;
  opacity: calc(var(--wave-glow) * 0.35);
  stroke-dasharray: 28 72;
}
[data-slot="model-activity-waveform-signal"] {
  stroke-width: 1.75;
  opacity: var(--wave-glow);
  stroke-dasharray: 14 86;
  filter: drop-shadow(0 0 3px currentColor);
}
@keyframes model-waveform-travel {
  from { stroke-dashoffset: 114; }
  to { stroke-dashoffset: 14; }
}
.model-activity-waveform[data-motion="active"] .model-activity-waveform-trail,
.model-activity-waveform[data-motion="active"] [data-slot="model-activity-waveform-signal"] {
  animation: model-waveform-travel var(--wave-duration) linear infinite;
}
~~~

Add the synchronized endpoint and reduced-motion rules:

~~~css
@keyframes model-waveform-arrival {
  0%, 82%, 100% {
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
  }
  92% {
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent),
      0 0 8px color-mix(in srgb, var(--wave-color) 28%, transparent);
  }
}
.model-activity-waveform[data-motion="active"] .streaming-status-telemetry {
  animation: model-waveform-arrival var(--wave-duration) linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .model-activity-waveform-trail,
  [data-slot="model-activity-waveform-signal"],
  .model-activity-waveform .streaming-status-telemetry {
    animation: none !important;
  }
}
~~~

- [ ] **Step 3: Integrate the component**

In streaming-status-bar.tsx:

- Replace ModelActivityHeartbeat with ModelActivityWaveform.
- Remove the compact label block.
- Make the desktop phrase bounded rather than flex: 1.
- Put the entire telemetry pill inside the waveform component and show the pill only when tokens or cost are nonzero.
- Keep elapsed time after ModelActivityWaveform so the empty track targets the timer/right edge.

Target structure:

~~~tsx
<ModelActivityWaveform sessionID={params.id ?? ""}>
  <Show when={tokens() > 0 || cost() > 0}>
    <div class="streaming-status-telemetry">
      <Show when={tokens() > 0}>
        <span class="streaming-token-usage" aria-label={tokenFormatter.format(Math.round(tokens())) + " tokens"}>
          <NumberTicker value={tokens()} format={formatTokens} />
          <span class="streaming-token-label"> tokens</span>
        </span>
      </Show>
      <Show when={cost() > 0}>
        <span class="streaming-cost" style={{ color: "var(--v2-state-fg-success)" }}>
          <NumberTicker value={cost()} format={formatCost} />
        </span>
      </Show>
    </div>
  </Show>
</ModelActivityWaveform>
~~~

- [ ] **Step 4: Finish responsive CSS and remove dot files**

In index.css, set desktop status-text-verbose to flex: 0 1 42% and max-width: 22rem. At max-width 640px hide both verbose and compact labels, set waveform gap to 5px, keep telemetry max-width at min(58vw, 180px), keep token usage overflow hidden with text-overflow ellipsis, hide streaming-cost, and continue hiding streaming-token-label at 390px. Remove dot-specific padding/selectors.

Delete model-activity-heartbeat.tsx and model-activity.css using apply_patch after imports move.

- [ ] **Step 5: Verify GREEN**

~~~bash
PLAYWRIGHT_WORKERS=1 bunx playwright test e2e/regression/session-model-activity-waveform.spec.ts e2e/regression/session-mobile-streaming-ui.spec.ts
bun --cwd packages/app run typecheck
bun --cwd packages/app run typecheck:e2e
bun --cwd packages/app run test:unit
~~~

Expected: all focused browser tests, typechecks, and units PASS with zero captured console errors.

- [ ] **Step 6: Commit**

~~~bash
git add packages/app/src/pages/session/composer packages/app/src/index.css packages/app/e2e/performance/timeline-stability/fixture.ts packages/app/e2e/regression/session-model-activity-waveform.spec.ts packages/app/e2e/regression/session-mobile-streaming-ui.spec.ts
git commit -m "Add responsive model activity waveform"
~~~

### Task 5: Visual QA and Performance Comparison

**Files:**
- Output outside repo: /tmp/model-waveform-desktop.png
- Output outside repo: /tmp/model-waveform-mobile.png
- Output outside repo: /tmp/model-waveform-reduced-motion.png
- Output outside repo: /tmp/model-waveform-candidate.log

**Interfaces:**
- Consumes: Tasks 2-4 selectors and motion behavior.
- Produces: screenshot evidence, console evidence, validation results, and baseline/candidate comparison.

- [ ] **Step 1: Validate desktop**

Run the Playwright flow at 1400x900:

~~~text
session opens -> status appears -> phrase precedes waveform -> waveform precedes telemetry
-> SSE delta keeps active state -> telemetry appears -> status height stays stable
~~~

Confirm URL/title, meaningful DOM, no framework overlay, no relevant console errors/warnings, and no horizontal overflow. Save /tmp/model-waveform-desktop.png.

- [ ] **Step 2: Validate mobile and reduced motion**

At 390x844, confirm both labels hidden, waveform gets flexible space, 7.1M remains visible, cost remains hidden, and no overflow. Save /tmp/model-waveform-mobile.png.

With reduced motion, confirm signal and telemetry animationName are none while state/tone remain correct. Save /tmp/model-waveform-reduced-motion.png.

- [ ] **Step 3: Run the focused regression matrix**

~~~bash
PLAYWRIGHT_WORKERS=1 bunx playwright test e2e/regression/session-model-activity-waveform.spec.ts e2e/regression/session-mobile-streaming-ui.spec.ts e2e/regression/session-todo-dock-navigation.spec.ts e2e/regression/session-timeline-transport.spec.ts
~~~

Expected: all selected tests PASS.

- [ ] **Step 4: Run full static validation**

~~~bash
bun run typecheck
bun --cwd packages/app run typecheck:e2e
bun --cwd packages/session-ui run typecheck
bun --cwd packages/app run test:unit
bun --cwd packages/session-ui run test
bun run build
git diff --check
~~~

Expected: all commands PASS. Existing Vite chunk-size and mixed-import warnings may remain, but no new warning or error is acceptable.

- [ ] **Step 5: Run and compare the candidate benchmark**

From packages/app:

~~~bash
TIMELINE_MINIMAL=1 PLAYWRIGHT_WORKERS=1 bunx playwright test --config e2e/performance/playwright.config.ts e2e/performance/timeline/session-timeline-benchmark.spec.ts | tee /tmp/model-waveform-candidate.log
~~~

Expected: PASS, pending renders zero, no timeline row or markdown replacements, and no repeatable greater-than-10% regression in long-task count/time. Compare all exact metrics with Task 1.

- [ ] **Step 6: Final diff review**

~~~bash
git status --short
git diff --check
git log -4 --oneline
~~~

If QA exposes a bug, add a failing regression first, apply the smallest fix, rerun relevant checks, and commit explicit files as "Polish model activity waveform". Do not make an empty commit.

- [ ] **Step 7: Handoff**

Report user-visible behavior, commands and counts, exact benchmark comparison, desktop/mobile/reduced-motion evidence, Browser plugin absence and Playwright fallback, remaining Safari risk, commit hashes, and push state. Do not push until explicitly requested.
