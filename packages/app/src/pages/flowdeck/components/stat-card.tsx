import { type ParentProps, Show } from "solid-js"

type StatCardProps = ParentProps<{
  label: string
  value: string | number
  sublabel?: string
  trend?: "up" | "down" | "neutral"
  trendValue?: string
  accent?: "default" | "success" | "warning" | "danger"
}>

const accentStyles: Record<string, string> = {
  default: "text-v2-text-text-strong",
  success: "text-v2-status-success-fg",
  warning: "text-v2-status-warning-fg",
  danger: "text-v2-status-danger-fg",
}

const trendIcons: Record<string, string> = {
  up: "\u2191",
  down: "\u2193",
  neutral: "\u2192",
}

const trendColors: Record<string, string> = {
  up: "text-v2-status-success-fg",
  down: "text-v2-status-danger-fg",
  neutral: "text-v2-text-text-muted",
}

export function StatCard(props: StatCardProps) {
  return (
    <div
      class={`
        flex flex-col gap-1 rounded-md border border-v2-border-border-default
        bg-v2-background-bg-raised px-4 py-3
      `}
    >
      <span class="text-11-regular uppercase tracking-wide text-v2-text-text-muted">{props.label}</span>
      <div class="flex items-baseline gap-2">
        <span class={`text-22-emphasis ${accentStyles[props.accent ?? "default"]}`}>{props.value}</span>
        <Show when={props.trend && props.trendValue}>
          <span class={`text-11-regular ${trendColors[props.trend ?? "neutral"]}`}>
            {trendIcons[props.trend ?? "neutral"]} {props.trendValue}
          </span>
        </Show>
      </div>
      <Show when={props.sublabel}>
        <span class="text-11-regular text-v2-text-text-weak">{props.sublabel}</span>
      </Show>
      {props.children}
    </div>
  )
}
