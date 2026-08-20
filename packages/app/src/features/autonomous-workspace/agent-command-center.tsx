import { For, Show, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import type { SessionLineageSnapshot } from "./contracts"
import { sessionLineageTree } from "./contracts"

export function SessionLineageCenter(props: { sessions: () => SessionLineageSnapshot[]; compact?: boolean; expanded?: () => string[]; onExpandedChange?: (ids: string[]) => void }) {
  const language = useLanguage()
  const roots = createMemo(() => sessionLineageTree(props.sessions()))
  const [localExpanded, setLocalExpanded] = createSignal<Set<string>>(new Set())
  const expanded = () => new Set(props.expanded?.() ?? [...localExpanded()])
  const toggle = (id: string) => { const next = expanded(); next.has(id) ? next.delete(id) : next.add(id); props.onExpandedChange ? props.onExpandedChange([...next]) : setLocalExpanded(next) }
  const renderSession = (session: SessionLineageSnapshot, depth: number) => {
    const hasChildren = () => (session.children?.length ?? 0) > 0
    const isExpanded = () => expanded().has(session.id)
    const model = () => [session.model?.providerID, session.model?.modelID].filter(Boolean).join(" / ")
    return <div role="treeitem" aria-expanded={hasChildren() ? isExpanded() : undefined} aria-level={depth + 1}>
      <button type="button" aria-label={session.label} class="group flex w-full min-w-0 items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-base-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus" style={{ "padding-left": `${12 + depth * 16}px` }} onClick={() => hasChildren() && toggle(session.id)}>
        <span class={`mt-1.5 size-2 shrink-0 rounded-full ${session.relation === "current" ? "bg-icon-info" : "bg-icon-muted"}`} aria-hidden="true" />
        <span class="min-w-0 flex-1"><span class="flex min-w-0 items-center gap-2"><span class="truncate text-12-emphasis text-text-strong">{session.label}</span><span class="shrink-0 text-11-regular text-text-muted">{session.relation === "unavailable" ? language.t("autonomousWorkspace.common.unavailable") : language.t(`autonomousWorkspace.lineage.relation.${session.relation}`)}</span></span><Show when={!props.compact && model()}><span class="mt-1 block max-w-full truncate font-mono text-11-regular text-text-weak">{model()}</span></Show></span>
        <Show when={hasChildren()}><span class="shrink-0 font-mono text-12-emphasis text-text-muted" aria-hidden="true">{isExpanded() ? "−" : "+"}</span></Show>
      </button>
      <Show when={isExpanded}><For each={session.children}>{(child) => renderSession(child, depth + 1)}</For></Show>
    </div>
  }
  return <section class="flex min-h-0 flex-col rounded-2xl border border-border-weak-base bg-surface-raised-strong" aria-labelledby="session-lineage-title"><header class="flex items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3"><div class="min-w-0"><p id="session-lineage-title" class="text-14-emphasis text-text-strong">{language.t("autonomousWorkspace.lineage.title")}</p><p class="text-12-regular text-text-weak">{language.t("autonomousWorkspace.lineage.description")}</p></div><span class="rounded-full bg-surface-base-hover px-2 py-1 text-11-regular text-text-muted">{language.t("autonomousWorkspace.lineage.count", { count: props.sessions().length })}</span></header><div class="min-h-0 overflow-auto p-2" role="tree" aria-label={language.t("autonomousWorkspace.lineage.treeLabel")}><Show when={roots().length > 0} fallback={<p class="px-2 py-6 text-center text-12-regular text-text-weak">{language.t("autonomousWorkspace.lineage.unavailable")}</p>}><For each={roots()}>{(session) => renderSession(session, 0)}</For></Show></div></section>
}
