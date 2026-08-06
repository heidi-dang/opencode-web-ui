import { type ComponentProps, Show, createMemo, splitProps } from "solid-js"
import "./progress-v2.css"

export interface ProgressV2LinearProps extends ComponentProps<"div"> {
  /** Progress value 0–100. */
  value: number
  /** Accessible label. */
  label?: string
  /** Show percentage text. Default false. */
  showValue?: boolean
}

/**
 * ProgressV2 — Linear progress bar respecting prefers-reduced-motion.
 *
 * Uses var(--v2-gradient-brand) for the fill and animates the indeterminate
 * variant with the streaming-border-flow keyframe already defined in index.css.
 */
export function ProgressV2(props: ProgressV2LinearProps) {
  const [split, rest] = splitProps(props, [
    "value",
    "label",
    "showValue",
    "class",
    "classList",
  ])
  const clampedValue = createMemo(() => Math.min(100, Math.max(0, split.value)))
  return (
    <div
      {...rest}
      data-component="progress-v2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedValue()}
      aria-label={split.label}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <div
        data-slot="progress-v2-track"
      >
        <div
          data-slot="progress-v2-fill"
          style={{ width: `${clampedValue()}%` }}
        />
      </div>
      <Show when={split.showValue}>
        <span data-slot="progress-v2-value">{clampedValue()}%</span>
      </Show>
    </div>
  )
}

export interface ProgressV2RingProps extends ComponentProps<"svg"> {
  /** Progress value 0–100. */
  value: number
  /** Radius of the ring. Default 10. */
  radius?: number
  /** Accessible label. */
  label?: string
}

/**
 * ProgressV2Ring — Circular SVG progress ring.
 *
 * Used in the session todo dock. Respects prefers-reduced-motion by
 * rendering at the exact value without transition when motion is reduced.
 */
export function ProgressV2Ring(props: ProgressV2RingProps) {
  const [split, rest] = splitProps(props, [
    "value",
    "radius",
    "label",
    "class",
    "classList",
  ])
  const r = () => split.radius ?? 10
  const circumference = () => 2 * Math.PI * r()
  const clampedValue = createMemo(() => Math.min(100, Math.max(0, split.value)))
  const dashOffset = createMemo(
    () => circumference() - (clampedValue() / 100) * circumference()
  )
  const size = () => (r() + 3) * 2

  return (
    <svg
      {...rest}
      data-component="progress-v2-ring"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clampedValue()}
      aria-label={split.label}
      width={size()}
      height={size()}
      viewBox={`0 0 ${size()} ${size()}`}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {/* Track */}
      <circle
        data-slot="progress-v2-ring-track"
        cx={size() / 2}
        cy={size() / 2}
        r={r()}
        fill="none"
        stroke-width="2"
      />
      {/* Fill */}
      <circle
        data-slot="progress-v2-ring-fill"
        cx={size() / 2}
        cy={size() / 2}
        r={r()}
        fill="none"
        stroke-width="2"
        stroke-dasharray={String(circumference())}
        stroke-dashoffset={String(dashOffset())}
        stroke-linecap="round"
        style={{
          "--ring-circumference": String(circumference()),
          "--ring-offset": String(dashOffset()),
          transform: "rotate(-90deg)",
          "transform-origin": "50% 50%",
        }}
      />
    </svg>
  )
}
