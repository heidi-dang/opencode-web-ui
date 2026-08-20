import { For, Show, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import type { AgentExecutionEvent, ContextUsageSnapshot, WorkspaceChange } from "./contracts"
import type { WorkspaceContextTab } from "./workspace-preferences"

export function ContextIntelligence(props: {
  usage: () => ContextUsageSnapshot | undefined
  events?: () => AgentExecutionEvent[]
  tab?: () => WorkspaceContextTab
  onTabChange?: (tab: WorkspaceContextTab) => void
}) {
  const language = useLanguage()
  const [localTab, setLocalTab] = createSignal<WorkspaceContextTab>("usage")
  const tab = () => props.tab?.() ?? localTab()
  const setTab = (next: WorkspaceContextTab) => props.onTabChange ? props.onTabChange(next) : setLocalTab(next)
  const usage = () => props.usage()
  const unavailable = () => language.t("autonomousWorkspace.common.unavailable")
  const number = (value?: number) => value === undefined ? unavailable() : new Intl.NumberFormat(language.intl()).format(value)
  const cost = () => usage()?.cost === undefined
    ? unavailable()
    : new Intl.NumberFormat(language.intl(), { maximumFractionDigits: 6 }).format(usage()!.cost!)
  const events = () => props.events?.() ?? []
  const latestEvent = () => events().at(-1)
  return <section class="rounded-2xl border border-border-weak-base bg-surface-raised-strong p-4" aria-labelledby="context-intelligence-title">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div><p id="context-intelligence-title" class="text-14-emphasis text-text-strong">{language.t("autonomousWorkspace.context.title")}</p><p class="text-12-regular text-text-weak">{language.t("autonomousWorkspace.context.description")}</p></div>
      <div class="flex shrink-0 gap-1 rounded-lg bg-surface-base p-1" role="tablist" aria-label={language.t("autonomousWorkspace.context.title")}>
        <button type="button" id="context-tab-usage" role="tab" aria-controls="context-panel-usage" aria-selected={tab() === "usage"} tabIndex={tab() === "usage" ? 0 : -1} class={`rounded-md px-2 py-1 text-11-emphasis transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${tab() === "usage" ? "bg-surface-raised-strong text-text-strong" : "text-text-muted hover:text-text-base"}`} onClick={() => setTab("usage")}>{language.t("context.usage.usage")}</button>
        <button type="button" id="context-tab-activity" role="tab" aria-controls="context-panel-activity" aria-selected={tab() === "activity"} tabIndex={tab() === "activity" ? 0 : -1} class={`rounded-md px-2 py-1 text-11-emphasis transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus ${tab() === "activity" ? "bg-surface-raised-strong text-text-strong" : "text-text-muted hover:text-text-base"}`} onClick={() => setTab("activity")}>{language.t("autonomousWorkspace.views.timeline")}</button>
      </div>
    </header>
    <Show when={() => tab() === "usage"} fallback={<div class="mt-4 grid gap-2 sm:grid-cols-2"><Metric label={language.t("autonomousWorkspace.timeline.count", { count: events().length })} value={events().length > 0 ? language.t(latestEvent()!.timelineLabelKey) : language.t("autonomousWorkspace.timeline.empty")} /><Metric label={language.t("autonomousWorkspace.timeline.state.completed")} value={latestEvent() ? language.t(`autonomousWorkspace.timeline.state.${latestEvent()!.state}`) : language.t("autonomousWorkspace.common.unavailable")} /></div>}>
      <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label={language.t("autonomousWorkspace.context.provider")} value={usage()?.model?.providerID ?? unavailable()} /><Metric label={language.t("autonomousWorkspace.context.model")} value={usage()?.model?.modelID ?? unavailable()} /><Metric label={language.t("autonomousWorkspace.context.inputTokens")} value={number(usage()?.inputTokens)} /><Metric label={language.t("autonomousWorkspace.context.outputTokens")} value={number(usage()?.outputTokens)} /><Metric label={language.t("autonomousWorkspace.context.reasoningTokens")} value={number(usage()?.reasoningTokens)} /><Metric label={language.t("autonomousWorkspace.context.cacheReadTokens")} value={number(usage()?.cacheReadTokens)} /><Metric label={language.t("autonomousWorkspace.context.cacheWriteTokens")} value={number(usage()?.cacheWriteTokens)} /><Metric label={language.t("autonomousWorkspace.context.totalTokens")} value={number(usage()?.totalTokens)} /><Metric label={language.t("autonomousWorkspace.context.cost")} value={cost()} /></div>
    </Show>
  </section>
}

function Metric(props: { label: string; value: string }) { return <div class="min-w-0 rounded-xl border border-border-weak-base/70 bg-surface-base px-3 py-2"><p class="text-11-regular text-text-weak">{props.label}</p><p class="mt-1 truncate font-mono text-12-emphasis text-text-strong">{props.value}</p></div> }

export function ChangesReviewCenter(props: { changes: () => WorkspaceChange[]; loading?: () => boolean; onSelect?: (change: WorkspaceChange) => void }) {
  const language = useLanguage()
  return <section class="flex min-h-0 flex-col rounded-2xl border border-border-weak-base bg-surface-raised-strong" aria-labelledby="changes-review-title"><header class="flex items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3"><div><p id="changes-review-title" class="text-14-emphasis text-text-strong">{language.t("autonomousWorkspace.changes.title")}</p><p class="text-12-regular text-text-weak">{language.t("autonomousWorkspace.changes.description")}</p></div><span class="font-mono text-11-regular text-text-muted">{language.t("autonomousWorkspace.changes.count", { count: props.changes().length })}</span></header><div class="min-h-0 overflow-auto p-2"><Show when={!props.loading?.()} fallback={<p class="px-2 py-8 text-center text-12-regular text-text-weak">{language.t("session.review.loadingChanges")}</p>}><Show when={props.changes().length > 0} fallback={<p class="px-2 py-8 text-center text-12-regular text-text-weak">{language.t("autonomousWorkspace.changes.empty")}</p>}><For each={props.changes()}>{(change) => <button type="button" aria-label={change.file} title={change.file} class="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus" onClick={() => props.onSelect?.(change)}><span class="shrink-0 rounded-md bg-surface-base-hover px-1.5 py-0.5 font-mono text-11-emphasis text-text-muted">{language.t(`autonomousWorkspace.changes.status.${change.status}`)}</span><span class="min-w-0 flex-1 truncate font-mono text-12-regular text-text-strong">{change.file}</span><span class="shrink-0 font-mono text-11-regular text-text-weak"><Show when={change.additions !== undefined} fallback={change.deletions === undefined ? language.t("autonomousWorkspace.common.unavailable") : undefined}>{language.t("autonomousWorkspace.changes.additions", { count: change.additions! })}</Show> <Show when={change.deletions !== undefined}>{language.t("autonomousWorkspace.changes.deletions", { count: change.deletions! })}</Show></span></button>}</For></Show></Show></div></section>
}
