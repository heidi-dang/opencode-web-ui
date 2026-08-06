import { type ComponentProps, splitProps } from "solid-js"
import "./focus-ring-v2.css"

export interface FocusRingV2Props extends ComponentProps<"div"> {
  /**
   * Glow intensity when focused. Defaults to "sm".
   * Use "none" to disable glow and keep only the accent border.
   */
  glow?: "none" | "sm" | "md"
}

/**
 * FocusRingV2 — Composable focus ring wrapper.
 *
 * Wraps a child and applies a visible focus ring using --v2-border-highlight
 * and --v2-glow-accent-* when the child receives keyboard focus.
 *
 * Apply this to interactive containers that do not already have a built-in
 * focus indicator (e.g. custom panel regions, card-like buttons).
 *
 * Do not apply to elements that already use Kobalte or the UI library's
 * focus-visible utilities — those already inherit the correct ring.
 */
export function FocusRingV2(props: FocusRingV2Props) {
  const [split, rest] = splitProps(props, ["glow", "class", "classList"])
  return (
    <div
      {...rest}
      data-component="focus-ring-v2"
      data-glow={split.glow ?? "sm"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}
