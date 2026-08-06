import { type ComponentProps, splitProps } from "solid-js"
import "./skeleton-v2.css"

export interface SkeletonV2Props extends ComponentProps<"div"> {
  /** Width of the skeleton. CSS value. Default "100%". */
  width?: string
  /** Height of the skeleton. CSS value. Default "14px". */
  height?: string
  /** Border radius. CSS value. Default "4px". */
  radius?: string
}

/**
 * SkeletonV2 — Loading skeleton with shimmer animation.
 *
 * Animation is disabled when the user has requested reduced motion.
 * Pair with a Suspense boundary or a conditional Show.
 */
export function SkeletonV2(props: SkeletonV2Props) {
  const [split, rest] = splitProps(props, [
    "width",
    "height",
    "radius",
    "class",
    "classList",
  ])
  return (
    <div
      {...rest}
      data-component="skeleton-v2"
      aria-hidden="true"
      style={{
        width: split.width ?? "100%",
        height: split.height ?? "14px",
        "border-radius": split.radius ?? "4px",
      }}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}
