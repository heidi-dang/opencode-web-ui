import { type ComponentProps, Show, splitProps } from "solid-js"
import "./status-badge-v2.css"

export type StatusBadgeV2Variant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent"

export interface StatusBadgeV2Props extends ComponentProps<"span"> {
  /** Semantic status variant. */
  variant?: StatusBadgeV2Variant
  /** Compact size (fewer vertical padding). */
  compact?: boolean
  /** Show a leading status dot. */
  dot?: boolean
}

/**
 * StatusBadgeV2 — Inline semantic status indicator.
 *
 * Matches Deep Aurora token semantic colours: success/warning/danger/info/accent.
 * The `dot` prop adds a filled leading indicator useful for live status.
 */
export function StatusBadgeV2(props: StatusBadgeV2Props) {
  const [split, rest] = splitProps(props, [
    "variant",
    "compact",
    "dot",
    "class",
    "classList",
  ])
  return (
    <span
      {...rest}
      data-component="status-badge-v2"
      data-variant={split.variant ?? "default"}
      data-compact={split.compact ? "true" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={split.dot}>
        <span data-slot="status-badge-v2-dot" aria-hidden="true" />
      </Show>
      {props.children}
    </span>
  )
}
