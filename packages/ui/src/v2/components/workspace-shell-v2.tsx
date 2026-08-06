import { type ComponentProps, splitProps } from "solid-js"
import "./workspace-shell-v2.css"

export interface WorkspaceShellV2Props extends ComponentProps<"div"> {
  /** Whether to render the ambient canvas gradient background. Default true. */
  ambientGradient?: boolean
}

/**
 * WorkspaceShellV2 — Outer layout container for the Deep Aurora workspace.
 *
 * Renders the ambient canvas gradient exactly once at the top of the layout
 * tree, so individual pages and panels do not need to repeat it.
 *
 * Use this as the root layout wrapper rather than applying gradient styles
 * to individual page components.
 */
export function WorkspaceShellV2(props: WorkspaceShellV2Props) {
  const [split, rest] = splitProps(props, [
    "ambientGradient",
    "class",
    "classList",
  ])
  return (
    <div
      {...rest}
      data-component="workspace-shell-v2"
      data-ambient={split.ambientGradient !== false ? "true" : "false"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    />
  )
}
