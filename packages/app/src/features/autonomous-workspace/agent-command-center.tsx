import { For, Show, createMemo, createSignal } from "solid-js"
import type { AgentRuntimeSnapshot } from "./contracts"
import { agentTree } from "./contracts"

const stateLabel: Record<AgentRuntimeSnapshot["state"], string> = {
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  tool: "Tool execution",
  waiting: "Waiting",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  unknown: "Unknown",
}

export function AgentCommandCenter(props: { agents: () => AgentRuntimeSnapshot[]; compact?: boolean }) {
  const roots = createMemo(() => agentTree(props.agents()))
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <section class="flex min-h-0 flex-col rounded-2xl border border-border-weak-base bg-surface-raised-strong shadow-[0_16px_40px_rgba(0,0,0,0.18)]" aria-labelledby="agent-command-center-title">
      <header class="flex items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3">
        <div class="min-w-0">
          <p id="agent-command-center-title" class="text-14-emphasis text-text-strong">Agent command center</p>
          <p class="text-12-regular text-text-weak">Live runtime state from the active session</p>
        </div>
        <span class="rounded-full bg-surface-base-hover px-2 py-1 text-11-regular text-text-muted">{props.agents().length} agents</span>
      </header>
      <div class="min-h-0 overflow-auto p-2" role="tree" aria-label="Agent hierarchy">
        <Show when={roots().length > 0} fallback={<p class="px-2 py-6 text-center text-12-regular text-text-weak">No runtime agent data available.</p>}>
          <For each={roots()}>{(agent) => <AgentRow agent={agent} depth={0} compact={props.compact} expanded={expanded()} onToggle={toggle} />}</For>
        </Show>
      </div>
    </section>
  )
}

function AgentRow(props: { agent: AgentRuntimeSnapshot; depth: number; compact?: boolean; expanded: Set<string>; onToggle: (id: string) => void }) {
  const hasChildren = () => (props.agent.children?.length ?? 0) > 0
  const isExpanded = () => props.expanded.has(props.agent.id)
  const state = () => props.agent.state
  return (
    <div role="treeitem" aria-expanded={hasChildren() ? isExpanded() : undefined} aria-level={props.depth + 1}>
      <button type="button" class="group flex w-full min-w-0 items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus" style={{ "padding-left": `${12 + props.depth * 16}px` }} onClick={() => hasChildren() && props.onToggle(props.agent.id)}>
        <span class={`mt-1 size-2 shrink-0 rounded-full ${state() === "working" || state() === "tool" ? "bg-icon-info animate-pulse" : state() === "failed" ? "bg-icon-critical" : state() === "completed" ? "bg-icon-success" : "bg-icon-muted"}`} aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-12-emphasis text-text-strong">{props.agent.label}</span>
            <span class="shrink-0 text-11-regular text-text-muted">{stateLabel[state()]}</span>
          </span>
          <Show when={!props.compact && (props.agent.task || props.agent.activity || props.agent.currentTool)}>
            <span class="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-11-regular text-text-weak">
              <Show when={props.agent.task}><span class="max-w-full truncate">{props.agent.task}</span></Show>
              <Show when={props.agent.currentTool}><span class="font-mono">{props.agent.currentTool}</span></Show>
              <Show when={props.agent.currentFile}><span class="max-w-full truncate font-mono">{props.agent.currentFile}</span></Show>
            </span>
          </Show>
        </span>
        <Show when={props.agent.progress !== undefined}><span class="shrink-0 font-mono text-11-regular text-text-muted">{Math.round(props.agent.progress! * 100)}%</span></Show>
        <Show when={hasChildren()}><span class="shrink-0 text-text-muted" aria-hidden="true">{isExpanded() ? "−" : "+"}</span></Show>
      </button>
      <Show when={isExpanded()}>
        <For each={props.agent.children}>{(child) => <AgentRow agent={child} depth={props.depth + 1} compact={props.compact} expanded={props.expanded} onToggle={props.onToggle} />}</For>
      </Show>
    </div>
  )
}
