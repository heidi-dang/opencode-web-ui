import { For, Show } from "solid-js"

export type ChartDatum = {
  label: string
  value: number
  color?: string
}

type BarChartProps = {
  data: ChartDatum[]
  height?: number
  horizontal?: boolean
  class?: string
}

const DEFAULT_COLORS = [
  "var(--v2-interactive-interactive-primary)",
  "var(--v2-status-success-fg)",
  "var(--v2-status-warning-fg)",
  "var(--v2-status-danger-fg)",
  "var(--v2-interactive-interactive-secondary)",
  "var(--v2-text-text-muted)",
]

/**
 * Simple SVG horizontal bar chart. Zero dependencies.
 */
export function BarChart(props: BarChartProps) {
  const height = () => props.height ?? 160
  const max = () => Math.max(...props.data.map((d) => d.value), 1)

  return (
    <div class={`flex flex-col gap-1.5 ${props.class ?? ""}`}>
      <For each={props.data}>
        {(datum, index) => {
          const pct = () => Math.round((datum.value / max()) * 100)
          const color = () => datum.color ?? DEFAULT_COLORS[index() % DEFAULT_COLORS.length]
          return (
            <div class="flex items-center gap-2">
              <span class="w-24 shrink-0 truncate text-right text-11-regular text-v2-text-text-muted">
                {datum.label}
              </span>
              <div class="relative h-5 flex-1 overflow-hidden rounded-sm bg-v2-background-bg-sunken">
                <div
                  class="absolute inset-y-0 left-0 rounded-sm transition-all duration-300"
                  style={{ width: `${pct()}%`, "background-color": color() }}
                />
              </div>
              <span class="w-10 shrink-0 text-11-regular text-v2-text-text-weak">{datum.value}</span>
            </div>
          )
        }}
      </For>
    </div>
  )
}

type StackedBarProps = {
  segments: { label: string; value: number; color: string }[]
  class?: string
}

/**
 * Single horizontal stacked bar showing proportional segments.
 */
export function StackedBar(props: StackedBarProps) {
  const total = () => Math.max(props.segments.reduce((sum, s) => sum + s.value, 0), 1)

  return (
    <div class={props.class}>
      <div class="flex h-6 w-full overflow-hidden rounded-sm">
        <For each={props.segments}>
          {(seg) => {
            const pct = () => (seg.value / total()) * 100
            return (
              <Show when={seg.value > 0}>
                <div
                  class="flex items-center justify-center transition-all duration-300"
                  style={{ width: `${pct()}%`, "background-color": seg.color }}
                  title={`${seg.label}: ${seg.value}`}
                >
                  <Show when={pct() > 12}>
                    <span class="text-10-regular text-white">{seg.value}</span>
                  </Show>
                </div>
              </Show>
            )
          }}
        </For>
      </div>
      <div class="mt-1.5 flex flex-wrap gap-3">
        <For each={props.segments}>
          {(seg) => (
            <div class="flex items-center gap-1.5">
              <div class="h-2.5 w-2.5 rounded-sm" style={{ "background-color": seg.color }} />
              <span class="text-11-regular text-v2-text-text-muted">
                {seg.label} ({seg.value})
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

type DonutChartProps = {
  data: ChartDatum[]
  size?: number
  class?: string
}

/**
 * Simple SVG donut/pie chart.
 */
export function DonutChart(props: DonutChartProps) {
  const size = () => props.size ?? 120
  const radius = () => size() / 2 - 8
  const circumference = () => 2 * Math.PI * radius()
  const total = () => Math.max(props.data.reduce((sum, d) => sum + d.value, 0), 1)

  const segments = () => {
    let offset = 0
    return props.data.map((d, i) => {
      const pct = d.value / total()
      const seg = {
        ...d,
        color: d.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        dashArray: `${pct * circumference()} ${circumference()}`,
        dashOffset: -offset * circumference(),
        pct: Math.round(pct * 100),
      }
      offset += pct
      return seg
    })
  }

  return (
    <div class={`flex items-center gap-4 ${props.class ?? ""}`}>
      <svg width={size()} height={size()} viewBox={`0 0 ${size()} ${size()}`}>
        <For each={segments()}>
          {(seg) => (
            <circle
              cx={size() / 2}
              cy={size() / 2}
              r={radius()}
              fill="none"
              stroke={seg.color}
              stroke-width="12"
              stroke-dasharray={seg.dashArray}
              stroke-dashoffset={seg.dashOffset}
              transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
            />
          )}
        </For>
      </svg>
      <div class="flex flex-col gap-1">
        <For each={segments()}>
          {(seg) => (
            <div class="flex items-center gap-1.5">
              <div class="h-2.5 w-2.5 rounded-full" style={{ "background-color": seg.color }} />
              <span class="text-11-regular text-v2-text-text-muted">
                {seg.label} ({seg.pct}%)
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
