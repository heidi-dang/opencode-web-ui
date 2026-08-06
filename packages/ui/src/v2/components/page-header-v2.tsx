import { type ComponentProps, type JSXElement, splitProps } from "solid-js"
import "./page-header-v2.css"

export interface PageHeaderV2Props extends ComponentProps<"header"> {
  /** Primary page title. */
  title: string
  /** Optional subtitle or description. */
  subtitle?: string
  /** Slot for trailing actions (buttons, selectors). */
  actions?: JSXElement
}

/**
 * PageHeaderV2 — Standard page-level header for Deep Aurora workspace pages.
 *
 * Provides consistent hierarchy between title, subtitle and page actions.
 * Do not add glow or gradient effects to this component; the ambient gradient
 * lives on WorkspaceShellV2.
 */
export function PageHeaderV2(props: PageHeaderV2Props) {
  const [split, rest] = splitProps(props, [
    "title",
    "subtitle",
    "actions",
    "class",
    "classList",
  ])
  return (
    <header
      {...rest}
      data-component="page-header-v2"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <div data-slot="page-header-v2-text">
        <h1 data-slot="page-header-v2-title">{split.title}</h1>
        {split.subtitle && (
          <p data-slot="page-header-v2-subtitle">{split.subtitle}</p>
        )}
      </div>
      {split.actions && (
        <div data-slot="page-header-v2-actions">{split.actions}</div>
      )}
    </header>
  )
}
