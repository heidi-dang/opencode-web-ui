import { type ComponentProps, type JSXElement, splitProps } from "solid-js"
import "./section-header-v2.css"

export interface SectionHeaderV2Props extends ComponentProps<"div"> {
  /** Section label. */
  label: string
  /** Optional trailing actions or count. */
  trailing?: JSXElement
}

/**
 * SectionHeaderV2 — Group or section label within a page.
 *
 * Used inside lists, panels and cards to provide group hierarchy.
 * Renders as a semantic div with accessible labelling; wrap in a
 * role="group" or aria-labelledby externally if needed.
 */
export function SectionHeaderV2(props: SectionHeaderV2Props) {
  const [split, rest] = splitProps(props, ["label", "trailing", "class", "classList"])
  return (
    <div
      {...rest}
      data-component="section-header-v2"
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <span data-slot="section-header-v2-label">{split.label}</span>
      {split.trailing && (
        <span data-slot="section-header-v2-trailing">{split.trailing}</span>
      )}
    </div>
  )
}
