import { Show } from "solid-js"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { EmptyStateV2, ErrorStateV2 } from "@opencode-ai/ui/v2/empty-state-v2"
import { useFlowdeckStats } from "./flowdeck-stats"
import { PipelinePanel } from "./components/pipeline-panel"
import { GovernancePanel } from "./components/governance-panel"
import { AgentPanel } from "./components/agent-panel"
import { PrMonitorPanel } from "./components/pr-monitor-panel"

export function FlowdeckDashboard() {
  const { data, isLoading, isError, refetch } = useFlowdeckStats()

  return (
    <div
      class={`
        m-2 flex min-h-0 flex-1 flex-col self-stretch overflow-hidden rounded-[10px]
        bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]
      `}
    >
      {/* Header */}
      <div class="flex items-center justify-between border-b border-v2-border-border-default px-6 py-4">
        <div class="flex items-center gap-3">
          <div class="flex h-8 w-8 items-center justify-center rounded-md bg-v2-interactive-interactive-primary-bg">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4h12M2 8h8M2 12h10"
                stroke="var(--v2-interactive-interactive-primary)"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </div>
          <div>
            <h1 class="text-16-emphasis text-v2-text-text-strong">FlowDeck Statistics</h1>
            <p class="text-11-regular text-v2-text-text-muted">
              Multi-agent orchestration analytics across all sessions
            </p>
          </div>
        </div>
        <ButtonV2
          variant="outline"
          size="small"
          onClick={refetch}
        >
          Refresh
        </ButtonV2>
      </div>

      {/* Content */}
      <ScrollView class="h-full flex-1">
        <div class="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-6 py-6">
          {/* Loading state */}
          <Show when={isLoading()}>
            <div class="flex flex-col items-center justify-center gap-3 py-20">
              <div class="h-8 w-8 animate-spin rounded-full border-2 border-v2-border-border-default border-t-v2-interactive-interactive-primary" />
              <p class="text-12-regular text-v2-text-text-muted">Loading FlowDeck statistics...</p>
            </div>
          </Show>

          {/* Error state */}
          <Show when={isError()}>
            <div class="py-12">
              <ErrorStateV2
                title="Failed to load statistics"
                description="Unable to fetch FlowDeck analytics at this time."
                action={
                  <ButtonV2 variant="contrast" size="small" onClick={refetch}>
                    Retry
                  </ButtonV2>
                }
              />
            </div>
          </Show>

          {/* Empty state */}
          <Show when={!isLoading() && !isError() && data() && !data()!.hasFlowdeckActivity}>
            <div class="py-12">
              <EmptyStateV2
                title="No FlowDeck activity detected"
                description="Statistics will appear here once sessions use FlowDeck tools (fdx-*, planning-state, codegraph, etc.)"
              />
            </div>
          </Show>

          {/* Dashboard panels */}
          <Show when={!isLoading() && !isError() && data()?.hasFlowdeckActivity}>
            <>
              <PipelinePanel stats={data()!.stats} pipeline={data()!.pipeline} />
              <GovernancePanel stats={data()!.stats} audit={data()!.audit} />
              <AgentPanel stats={data()!.stats} />
              <PrMonitorPanel stats={data()!.stats} />
            </>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
