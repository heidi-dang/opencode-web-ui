import { For, Show } from "solid-js"
import type { AggregatedFlowdeckStats } from "../parsers/session-parser"
import type { PipelineSummary } from "../parsers/pipeline-parser"
import { StatCard } from "./stat-card"
import { BarChart, StackedBar } from "./activity-chart"

type PipelinePanelProps = {
  stats: AggregatedFlowdeckStats
  pipeline?: PipelineSummary
}

export function PipelinePanel(props: PipelinePanelProps) {
  const completionRate = () =>
    props.stats.pipelineStarts > 0 ? Math.round((props.stats.pipelineCompletions / props.stats.pipelineStarts) * 100) : 0

  const stageData = () => {
    const freq = props.stats.stageFrequency
    return [
      { label: "Task", value: freq.task },
      { label: "Review", value: freq.review },
      { label: "Execute", value: freq.execute },
      { label: "Verify", value: freq.verify },
      { label: "Done", value: freq.done },
    ]
  }

  const pipelineSegments = () => [
    { label: "Completed", value: props.pipeline?.completedTopics ?? props.stats.pipelineCompletions, color: "var(--v2-status-success-fg)" },
    { label: "Active", value: props.pipeline?.activeTopics ?? (props.stats.pipelineStarts - props.stats.pipelineCompletions), color: "var(--v2-interactive-interactive-primary)" },
    { label: "Blocked", value: props.pipeline?.blockedTopics ?? 0, color: "var(--v2-status-danger-fg)" },
  ]

  return (
    <section class="flex flex-col gap-4">
      <h2 class="text-14-emphasis text-v2-text-text-strong">Pipeline & Tasks</h2>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Tasks Started"
          value={props.pipeline?.totalTopics ?? props.stats.pipelineStarts}
          sublabel="pipeline entries"
        />
        <StatCard
          label="Completed"
          value={props.pipeline?.completedTopics ?? props.stats.pipelineCompletions}
          accent="success"
          sublabel={`${completionRate()}% completion rate`}
        />
        <StatCard
          label="Active"
          value={props.pipeline?.activeTopics ?? Math.max(0, props.stats.pipelineStarts - props.stats.pipelineCompletions)}
          accent="warning"
        />
        <StatCard
          label="Blocked"
          value={props.pipeline?.blockedTopics ?? 0}
          accent="danger"
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
          <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">Stage Progression</h3>
          <BarChart data={stageData()} />
        </div>

        <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
          <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">Pipeline Status</h3>
          <StackedBar segments={pipelineSegments()} />
          <Show when={props.pipeline && props.pipeline.topics.length > 0}>
            <div class="mt-4 flex flex-col gap-1">
              <For each={props.pipeline!.topics.slice(0, 5)}>
                {(topic) => (
                  <div class="flex items-center justify-between text-11-regular">
                    <span class="truncate text-v2-text-text-base">{topic.slug}</span>
                    <span
                      class={`rounded-sm px-1.5 py-0.5 text-10-regular ${
                        topic.stage === "done"
                          ? "bg-v2-status-success-bg text-v2-status-success-fg"
                          : topic.blockers.length > 0
                            ? "bg-v2-status-danger-bg text-v2-status-danger-fg"
                            : "bg-v2-interactive-interactive-primary-bg text-v2-interactive-interactive-primary"
                      }`}
                    >
                      {topic.stage}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}
