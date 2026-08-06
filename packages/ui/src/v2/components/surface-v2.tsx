import { type ComponentProps, splitProps } from "solid-js"
import { Dynamic } from "solid-js/web"
import "./surface-v2.css"

export type SurfaceV2Variant =
  | "canvas"
  | "layer"
  | "raised"
  | "floating"
  | "glass"
  | "glass-strong"

export interface SurfaceV2Props extends ComponentProps<"div"> {
  /** Visual surface variant controlling background, border and elevation. */
  variant?: SurfaceV2Variant
  /** Override the rendered element tag. Defaults to "div". */
  as?: string
}

/**
 * SurfaceV2 — Polymorphic container for the Deep Aurora workspace system.
 *
 * Variants map directly to --v2 design tokens. Do not override background,
 * border or box-shadow inline; extend the variant system instead.
 */
export function SurfaceV2(props: SurfaceV2Props) {
  const [split, rest] = splitProps(props, ["variant", "as", "class", "classList"])
  return (
    <Dynamic
      component={split.as ?? "div"}
      {...rest}
      data-component="surface-v2"
      data-variant={split.variant ?? "layer"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}
