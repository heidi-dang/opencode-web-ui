import { TextField as Kobalte } from "@kobalte/core/text-field"
import { createSignal, Show, splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "./icon-button"
import { Tooltip } from "./tooltip"
import { copyToClipboard } from "../utils/clipboard"

export interface TextFieldProps
  extends ComponentProps<typeof Kobalte.Input>,
    Partial<
      Pick<
        ComponentProps<typeof Kobalte>,
        | "name"
        | "defaultValue"
        | "value"
        | "onChange"
        | "onKeyDown"
        | "validationState"
        | "required"
        | "disabled"
        | "readOnly"
      >
    > {
  label?: string
  hideLabel?: boolean
  description?: string
  error?: string
  variant?: "normal" | "ghost"
  copyable?: boolean
  copyKind?: "clipboard" | "link"
  multiline?: boolean
  showCount?: boolean
}

export function TextField(props: TextFieldProps) {
  const i18n = useI18n()
  const [local, others] = splitProps(props, [
    "name",
    "defaultValue",
    "value",
    "onChange",
    "onKeyDown",
    "validationState",
    "required",
    "disabled",
    "readOnly",
    "class",
    "label",
    "hideLabel",
    "description",
    "error",
    "variant",
    "copyable",
    "copyKind",
    "multiline",
    "showCount",
  ])
  const [copied, setCopied] = createSignal(false)

  const label = () => {
    if (copied()) return i18n.t("ui.textField.copied")
    if (local.copyKind === "link") return i18n.t("ui.textField.copyLink")
    return i18n.t("ui.textField.copyToClipboard")
  }

  const icon = () => {
    if (copied()) return "check"
    if (local.copyKind === "link") return "link"
    return "copy"
  }

  async function handleCopy() {
    const value = local.value ?? local.defaultValue ?? ""
    const success = await copyToClipboard(value)
    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function handleClick() {
    if (local.copyable) void handleCopy()
  }

  return (
    <Kobalte
      data-component="input"
      data-variant={local.variant || "normal"}
      name={local.name}
      defaultValue={local.defaultValue}
      value={local.value}
      onChange={local.onChange}
      onKeyDown={local.onKeyDown}
      onClick={handleClick}
      required={local.required}
      disabled={local.disabled}
      readOnly={local.readOnly}
      validationState={local.validationState}
    >
      <Show when={local.label}>
        <Kobalte.Label data-slot="input-label" classList={{ "sr-only": local.hideLabel }}>
          {local.label}
          <Show when={local.required}>
            <span class="sr-only"> (required)</span>
          </Show>
        </Kobalte.Label>
      </Show>
      <div data-slot="input-wrapper">
        <Show
          when={local.multiline}
          fallback={
            <Kobalte.Input
              {...others}
              data-slot="input-input"
              class={local.class}
              aria-invalid={local.validationState === "invalid" ? "true" : undefined}
            />
          }
        >
          <Kobalte.TextArea
            {...others}
            autoResize
            data-slot="input-input"
            class={local.class}
            aria-invalid={local.validationState === "invalid" ? "true" : undefined}
          />
        </Show>
        <Show when={local.copyable}>
          <Tooltip value={label()} placement="top" gutter={4} forceOpen={copied()} skipDelayDuration={0}>
            <IconButton
              type="button"
              icon={icon()}
              variant="ghost"
              onClick={handleCopy}
              tabIndex={-1}
              data-slot="input-copy-button"
              aria-label={label()}
            />
          </Tooltip>
        </Show>
      </div>
      <div class="flex justify-between items-start gap-2 mt-1">
        <Show when={local.description}>
          <Kobalte.Description data-slot="input-description" class="flex-1">{local.description}</Kobalte.Description>
        </Show>
        <Show when={local.showCount || others.maxLength}>
          <div data-slot="input-counter" class="text-10-regular text-text-weak ml-auto" aria-live="polite">
            {String(local.value ?? local.defaultValue ?? "").length}
            <Show when={others.maxLength}> / {others.maxLength}</Show>
          </div>
        </Show>
      </div>
      <Kobalte.ErrorMessage data-slot="input-error">{local.error}</Kobalte.ErrorMessage>
    </Kobalte>
  )
}
