import { type ComponentProps, type JSXElement, splitProps } from "solid-js"
import "./empty-state-v2.css"

export interface EmptyStateV2Props extends ComponentProps<"div"> {
  /** Icon element to display at the top. */
  icon?: JSXElement
  /** Primary empty-state title. */
  title: string
  /** Optional supporting description. */
  description?: string
  /** Optional call-to-action element. */
  action?: JSXElement
}

/**
 * EmptyStateV2 — Workspace empty state for lists, panels and pages.
 *
 * Keep titles short and description under 2 lines. The icon slot accepts
 * any SVG icon; recommend a 32×32 or 24×24 size.
 */
export function EmptyStateV2(props: EmptyStateV2Props) {
  const [split, rest] = splitProps(props, [
    "icon",
    "title",
    "description",
    "action",
    "class",
    "classList",
  ])
  return (
    <div
      {...rest}
      data-component="empty-state-v2"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.icon && <div data-slot="empty-state-v2-icon">{split.icon}</div>}
      <div data-slot="empty-state-v2-body">
        <p data-slot="empty-state-v2-title">{split.title}</p>
        {split.description && (
          <p data-slot="empty-state-v2-description">{split.description}</p>
        )}
      </div>
      {split.action && (
        <div data-slot="empty-state-v2-action">{split.action}</div>
      )}
    </div>
  )
}

export interface ErrorStateV2Props extends ComponentProps<"div"> {
  /** Error message or title. */
  title: string
  /** Optional detail text. */
  description?: string
  /** Optional retry action. */
  action?: JSXElement
}

/**
 * ErrorStateV2 — Workspace error state with optional retry.
 */
export function ErrorStateV2(props: ErrorStateV2Props) {
  const [split, rest] = splitProps(props, [
    "title",
    "description",
    "action",
    "class",
    "classList",
  ])
  return (
    <div
      {...rest}
      data-component="error-state-v2"
      role="alert"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <div data-slot="error-state-v2-body">
        <p data-slot="error-state-v2-title">{split.title}</p>
        {split.description && (
          <p data-slot="error-state-v2-description">{split.description}</p>
        )}
      </div>
      {split.action && (
        <div data-slot="error-state-v2-action">{split.action}</div>
      )}
    </div>
  )
}
