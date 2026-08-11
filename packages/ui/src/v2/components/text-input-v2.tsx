import { type ComponentProps, type JSX, Show, splitProps, createSignal } from "solid-js"
import { Icon } from "./icon"
import { copyToClipboard } from "../../utils/clipboard"
import "./text-input-v2.css"

export interface TextInputV2Props extends Omit<ComponentProps<"input">, "type"> {
  /** Icon or adornment shown before the field value. */
  leadingIcon?: JSX.Element
  /** Show the trailing copy action. */
  showCopyButton?: boolean
  /** Show the trailing clear action. */
  showClearButton?: boolean
  /** Accessible label for the copy button. */
  copyLabel?: string
  /** Accessible label for the clear button. */
  clearLabel?: string
  onCopyClick?: (event: MouseEvent) => void
  onClearClick?: (event: MouseEvent) => void
  /** Apply tabular numerals to the field value. */
  numeric?: boolean
  /** Error styling for the field and value text. */
  invalid?: boolean
  /** `base` is 28px tall; `large` is 32px tall. */
  appearance?: "base" | "large"
  type?: ComponentProps<"input">["type"]
}

export function TextInputV2(props: TextInputV2Props) {
  const [local, inputProps] = splitProps(props, [
    "class",
    "classList",
    "leadingIcon",
    "showCopyButton",
    "showClearButton",
    "copyLabel",
    "clearLabel",
    "onCopyClick",
    "onClearClick",
    "numeric",
    "invalid",
    "appearance",
    "disabled",
  ])

  const [copied, setCopied] = createSignal(false)
  let inputRef: HTMLInputElement | undefined

  return (
    <div
      data-component="text-input-v2"
      data-disabled={local.disabled ? "" : undefined}
      data-invalid={local.invalid ? "" : undefined}
      data-numeric={local.numeric ? "" : undefined}
      data-appearance={local.appearance ?? "base"}
      data-leading-icon={local.leadingIcon ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <div data-slot="text-input-v2-value">
        <Show when={local.leadingIcon}>
          <span data-slot="text-input-v2-leading-icon">{local.leadingIcon}</span>
        </Show>
        <input
          {...inputProps}
          value={inputProps.value ?? ""}
          ref={(el) => {
            inputRef = el
            if (typeof inputProps.ref === "function") {
              inputProps.ref(el)
            } else if (inputProps.ref) {
              (inputProps as any).ref = el
            }
          }}
          type={inputProps.type ?? "text"}
          disabled={local.disabled}
          aria-invalid={local.invalid ? true : undefined}
          data-slot="text-input-v2-input"
        />
      </div>
      <Show when={local.showClearButton || local.showCopyButton}>
        <button
          type="button"
          data-slot="text-input-v2-icon-button"
          data-variant={local.showClearButton ? "clear" : "copy"}
          data-copied={!local.showClearButton && copied() ? "" : undefined}
          aria-label={
            local.showClearButton
              ? (local.clearLabel ?? "Clear")
              : (copied() ? "Copied!" : (local.copyLabel ?? "Copy"))
          }
          disabled={local.disabled}
          onMouseDown={(event) => {
            if (!local.showClearButton) return
            event.preventDefault()
          }}
          onClick={(event) => {
            if (local.showClearButton) {
              local.onClearClick?.(event)
              return
            }
            if (inputRef) {
              copyToClipboard(inputRef.value).then((success) => {
                if (success) {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }
              })
            }
            local.onCopyClick?.(event)
          }}
        >
          <Icon name={local.showClearButton ? "xmark-small" : (copied() ? "check" : "copy")} />
        </button>
      </Show>
    </div>
  )
}
