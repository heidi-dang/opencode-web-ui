import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import type { AgentExecutionEvent, ContextUsageSnapshot, SessionLineageSnapshot, WorkspaceChange } from "./contracts"
import type { WorkspaceView } from "./workspace-preferences"
import { SessionLineageCenter } from "./agent-command-center"
import { ExecutionTimeline } from "./execution-timeline"
import { ChangesReviewCenter, ContextIntelligence } from "./workspace-panels"

export function AutonomousWorkspace(props: {
  lineage: () => SessionLineageSnapshot[]
  events: () => AgentExecutionEvent[]
  changes: () => WorkspaceChange[]
  changesLoading?: () => boolean
  onSelectChange?: (change: WorkspaceChange) => void
  usage: () => ContextUsageSnapshot | undefined
  conversation: JSX.Element
  terminal?: JSX.Element
  view?: () => WorkspaceView
  onViewChange?: (view: WorkspaceView) => void
}) {
  const language = useLanguage()
  const [localView, setLocalView] = createSignal<WorkspaceView>("conversation")
  const view = () => props.view?.() ?? localView()
  const setView = (next: WorkspaceView) => {
    if (props.onViewChange) props.onViewChange(next)
    else setLocalView(next)
  }
  const views = createMemo(() => [
    { id: "conversation" as const, label: language.t("autonomousWorkspace.views.conversation") },
    { id: "lineage" as const, label: language.t("autonomousWorkspace.views.lineage") },
    { id: "timeline" as const, label: language.t("autonomousWorkspace.views.timeline") },
    { id: "changes" as const, label: language.t("autonomousWorkspace.views.changes") },
    { id: "context" as const, label: language.t("autonomousWorkspace.views.context") },
  ])
  return <main class="flex min-h-0 flex-1 flex-col bg-background"><header class="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border-weak-base px-3 sm:px-5"><div class="min-w-0"><p class="truncate text-14-emphasis text-text-strong">{language.t("autonomousWorkspace.title")}</p><p class="hidden text-11-regular text-text-weak sm:block">{language.t("autonomousWorkspace.description")}</p></div><nav class="flex max-w-[64vw] gap-1 overflow-x-auto" aria-label={language.t("autonomousWorkspace.views.label")}><For each={views()}>{(item) => <button type="button" aria-current={view() === item.id ? "page" : undefined} class={`shrink-0 rounded-lg px-2.5 py-1.5 text-11-emphasis transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${view() === item.id ? "bg-surface-base-hover text-text-strong" : "text-text-muted hover:bg-surface-base-hover hover:text-text-base"}`} onClick={() => setView(item.id)}>{item.label}</button>}</For></nav></header><div class="min-h-0 flex-1 overflow-auto p-3 sm:p-5"><div class="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-4"><Show when={view() === "conversation"}>{props.conversation}</Show><Show when={view() === "lineage"}><SessionLineageCenter sessions={props.lineage} /></Show><Show when={view() === "timeline"}><ExecutionTimeline events={props.events} /></Show><Show when={view() === "changes"}><ChangesReviewCenter changes={props.changes} loading={props.changesLoading} onSelect={props.onSelectChange} /></Show><Show when={view() === "context"}><ContextIntelligence usage={props.usage} /></Show><Show when={props.terminal}><aside class="min-h-0">{props.terminal}</aside></Show></div></div></main>
}

export function WorkspaceModeToggle(props: { enabled: () => boolean; onToggle: () => void }) {
  const language = useLanguage()
  return (
    <button
      type="button"
      aria-pressed={props.enabled()}
      class="rounded-lg border border-border-weak-base bg-surface-raised-strong px-2.5 py-1.5 text-11-emphasis text-text-muted shadow-sm transition-colors hover:bg-surface-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      onClick={props.onToggle}
    >
      {props.enabled()
        ? language.t("autonomousWorkspace.toggle.disable")
        : language.t("autonomousWorkspace.toggle.enable")}
    </button>
  )
}
