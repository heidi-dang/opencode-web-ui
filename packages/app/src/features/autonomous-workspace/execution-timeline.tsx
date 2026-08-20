import { For, Show, createSignal } from "solid-js"
import type { AgentExecutionEvent } from "./contracts"

const kindIcon: Record<AgentExecutionEvent["kind"], string> = {
  reasoning: "⋯", read: "↓", search: "⌕", edit: "✎", patch: "±", shell: "$", test: "✓", build: "▣", network: "↗", mcp: "◇", delegation: "↳", waiting: "…", retry: "↻", completion: "✓", cancellation: "×", failure: "!",
}

export function ExecutionTimeline(props: { events: () => AgentExecutionEvent[] }) {
  return (
    <section class="flex min-h-0 flex-col rounded-2xl border border-border-weak-base bg-surface-raised-strong" aria-labelledby="execution-timeline-title">
      <header class="flex items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3">
        <div><p id="execution-timeline-title" class="text-14-emphasis text-text-strong">Execution timeline</p><p class="text-12-regular text-text-weak">Normalized activity from the session runtime</p></div>
        <span class="font-mono text-11-regular text-text-muted">{props.events().length} events</span>
      </header>
      <ol class="min-h-0 overflow-auto p-3" aria-label="Execution events">
        <Show when={props.events().length > 0} fallback={<li class="py-8 text-center text-12-regular text-text-weak">No execution events available.</li>}>
          <For each={props.events()}>{(event) => <TimelineEvent event={event} />}</For>
        </Show>
      </ol>
    </section>
  )
}

function TimelineEvent(props: { event: AgentExecutionEvent }) {
  const [open, setOpen] = createSignal(false)
  const eventTime = () => new Date(props.event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  return (
    <li class="relative flex gap-3 pb-3 last:pb-0">
      <div class="flex w-7 shrink-0 flex-col items-center"><span class="grid size-7 place-items-center rounded-lg bg-surface-base-hover font-mono text-12-emphasis text-icon-info" aria-hidden="true">{kindIcon[props.event.kind]}</span><span class="mt-1 h-full w-px bg-border-weak-base last:hidden" aria-hidden="true" /></div>
      <div class="min-w-0 flex-1 rounded-xl border border-border-weak-base/70 bg-surface-base px-3 py-2">
        <button type="button" class="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus" aria-expanded={open()} onClick={() => setOpen((value) => !value)}>
          <span class="min-w-0"><span class="block truncate text-12-emphasis text-text-strong">{props.event.label}</span><span class="block text-11-regular text-text-weak">{eventTime()} {props.event.durationMs ? `· ${props.event.durationMs}ms` : ""}</span></span>
          <span class={`shrink-0 rounded-full px-2 py-0.5 text-11-regular ${props.event.state === "failed" ? "bg-surface-critical-weak text-text-critical" : props.event.state === "active" ? "bg-surface-info-weak text-text-info" : "bg-surface-base-hover text-text-muted"}`}>{props.event.state}</span>
        </button>
        <Show when={open() && (props.event.detail || props.event.output)}><pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-border-weak-base pt-2 font-mono text-11-regular text-text-weak">{props.event.detail ?? props.event.output}</pre></Show>
      </div>
    </li>
  )
}
