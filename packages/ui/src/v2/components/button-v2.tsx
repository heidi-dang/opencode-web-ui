import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, createMemo, splitProps } from "solid-js"
import { Icon, type IconProps } from "./icon"
import { LoaderV2 } from "./loader-v2"
import "./button-v2.css"

export interface ButtonV2Props
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?: "neutral" | "danger" | "warning" | "outline" | "contrast" | "ghost" | "ghost-muted" | "loading"
  icon?: IconProps["name"]
  loading?: boolean
}

export function ButtonV2(props: ButtonV2Props) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList", "loading"])
  const resolvedIcon = createMemo(() => split.icon)
  const isButtonLoading = () => !!split.loading || split.variant === "loading"
  const isDisabled = () => isButtonLoading() || !!rest.disabled
  return (
    <Kobalte
      {...rest}
      disabled={isDisabled()}
      aria-busy={isButtonLoading() ? "true" : undefined}
      data-component="button-v2"
      data-size={split.size || "normal"}
      data-variant={isButtonLoading() ? "loading" : split.variant || "neutral"}
      data-icon={resolvedIcon()}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Show when={isButtonLoading()}>
        <LoaderV2 class="animate-spin size-4" />
      </Show>
      <Show when={resolvedIcon() && !isButtonLoading()}>
        <Icon name={resolvedIcon()!} />
      </Show>
      {props.children}
    </Kobalte>
  )
}
