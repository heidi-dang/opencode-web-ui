import { type ComponentProps, type JSXElement, splitProps } from "solid-js"
import "./card-v2.css"

export interface CardV2Props extends ComponentProps<"div"> {
  /**
   * Optional hover-lift effect. Useful for interactive project/session rows.
   * Do not use on every card; reserve for primary interactive items only.
   */
  interactive?: boolean
  /** Whether to apply an accent border on hover/focus. Default false. */
  accentBorder?: boolean
}

/**
 * CardV2 — Developer-density information card for the Deep Aurora workspace.
 *
 * No decorative glow by default. Hover-lift and accent-border are opt-in.
 * Keep card content compact; avoid nesting another card inside a card.
 */
export function CardV2(props: CardV2Props) {
  const [split, rest] = splitProps(props, [
    "interactive",
    "accentBorder",
    "class",
    "classList",
  ])
  return (
    <div
      {...rest}
      data-component="card-v2"
      data-interactive={split.interactive ? "true" : undefined}
      data-accent-border={split.accentBorder ? "true" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}

/**
 * MetricCardV2 — Compact metric display card.
 *
 * Use for numeric KPI values in FlowDeck, Fleet status, or session summaries.
 */
export interface MetricCardV2Props extends ComponentProps<"div"> {
  /** Metric label. */
  label: string
  /** Metric value (string or element for rich formatting). */
  value: JSXElement
  /** Optional delta/trend indicator. */
  trend?: JSXElement
}

export function MetricCardV2(props: MetricCardV2Props) {
  const [split, rest] = splitProps(props, ["label", "value", "trend", "class", "classList"])
  return (
    <div
      {...rest}
      data-component="metric-card-v2"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <span data-slot="metric-card-v2-label">{split.label}</span>
      <span data-slot="metric-card-v2-value">{split.value}</span>
      {split.trend && (
        <span data-slot="metric-card-v2-trend">{split.trend}</span>
      )}
    </div>
  )
}
