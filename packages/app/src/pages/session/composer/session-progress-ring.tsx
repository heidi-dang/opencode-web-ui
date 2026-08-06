import { createMemo, Show } from "solid-js"
import type { Todo } from "@opencode-ai/sdk/v2"

const SIZE = 28
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface SessionProgressRingProps {
  todos: Todo[]
  /** Whether the session is currently working */
  working: boolean
}

/**
 * A circular SVG progress ring that fills as todos complete.
 * Only visible in V2 layout. Shows completion fraction.
 */
export function SessionProgressRing(props: SessionProgressRingProps) {
  const total = createMemo(() => props.todos.length)
  const done = createMemo(
    () => props.todos.filter((t) => t.status === "completed").length,
  )
  const fraction = createMemo(() => (total() > 0 ? done() / total() : 0))
  const dashOffset = createMemo(() => CIRCUMFERENCE * (1 - fraction()))
  const isComplete = createMemo(() => total() > 0 && done() === total())

  return (
    <Show when={total() > 0}>
      <div
        class={`progress-ring-container ${isComplete() ? "progress-complete-burst" : ""}`}
        title={`${done()} of ${total()} tasks done`}
        style={{
          position: "relative",
          width: `${SIZE}px`,
          height: `${SIZE}px`,
          "flex-shrink": "0",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ overflow: "visible" }}>
          {/* Track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--v2-glow-accent-sm, rgba(99, 102, 241, 0.15))"
            stroke-width={STROKE}
          />
          {/* Fill */}
          <circle
            class="progress-ring-circle"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={
              isComplete()
                ? "var(--v2-state-fg-success, rgba(16, 185, 129, 0.85))"
                : "var(--v2-text-text-accent, rgba(99, 102, 241, 0.75))"
            }
            stroke-width={STROKE}
            stroke-linecap="round"
            stroke-dasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            stroke-dashoffset={dashOffset()}
            style={{
              transition: "stroke-dashoffset 0.5s var(--v2-motion-easing-expressive, cubic-bezier(0.16, 1, 0.3, 1)), stroke 0.4s ease",
            }}
          />
        </svg>
        {/* Fraction text */}
        <span
          style={{
            position: "absolute",
            "font-size": "7.5px",
            "font-weight": "600",
            "line-height": "1",
            color: isComplete()
              ? "var(--v2-state-fg-success, rgba(16, 185, 129, 0.9))"
              : "var(--v2-text-text-accent, rgba(99, 102, 241, 0.85))",
            "text-align": "center",
            "pointer-events": "none",
            "user-select": "none",
            transition: "color 0.4s ease",
            "letter-spacing": "-0.3px",
          }}
          aria-hidden="true"
        >
          {done()}/{total()}
        </span>
      </div>
    </Show>
  )
}
