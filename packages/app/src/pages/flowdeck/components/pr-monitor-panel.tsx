import { Show } from "solid-js"
import type { AggregatedFlowdeckStats } from "../parsers/session-parser"
import { StatCard } from "./stat-card"
import { DonutChart, StackedBar } from "./activity-chart"

type PrMonitorPanelProps = {
  stats: AggregatedFlowdeckStats
}

export function PrMonitorPanel(props: PrMonitorPanelProps) {
  const pr = () => props.stats.prMonitor

  const successRate = () =>
    pr().repairAttempts > 0 ? Math.round((pr().repairSuccesses / pr().repairAttempts) * 100) : 0

  const failureClassification = () => [
    { label: "Real failures", value: Math.max(0, pr().failuresDetected - pr().flakyClassifications) },
    { label: "Flaky", value: pr().flakyClassifications },
  ]

  const repairFunnel = () => [
    { label: "Detected", value: pr().failuresDetected, color: "var(--v2-status-danger-fg)" },
    { label: "Attempted", value: pr().repairAttempts, color: "var(--v2-status-warning-fg)" },
    { label: "Succeeded", value: pr().repairSuccesses, color: "var(--v2-status-success-fg)" },
  ]

  const hasData = () => pr().failuresDetected > 0 || pr().repairAttempts > 0

  return (
    <section class="flex flex-col gap-4">
      <h2 class="text-14-emphasis text-v2-text-text-strong">PR Monitor & CI</h2>

      <Show
        when={hasData()}
        fallback={
          <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-6 text-center">
            <p class="text-12-regular text-v2-text-text-muted">
              No PR Monitor activity detected. CI auto-repair events will appear here when the
              fdx-pr-monitor tool is invoked across sessions.
            </p>
          </div>
        }
      >
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="CI Failures" value={pr().failuresDetected} accent="danger" sublabel="detected" />
          <StatCard label="Repair Attempts" value={pr().repairAttempts} accent="warning" />
          <StatCard
            label="Success Rate"
            value={`${successRate()}%`}
            accent={successRate() >= 70 ? "success" : "warning"}
            sublabel={`${pr().repairSuccesses} fixed`}
          />
          <StatCard label="Flaky Tests" value={pr().flakyClassifications} sublabel="auto-retried" />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
            <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">Repair Funnel</h3>
            <StackedBar segments={repairFunnel()} />
            <div class="mt-4 flex flex-col gap-1 text-11-regular text-v2-text-text-muted">
              <div class="flex justify-between">
                <span>Detection to attempt rate</span>
                <span class="text-v2-text-text-base">
                  {pr().failuresDetected > 0 ? Math.round((pr().repairAttempts / pr().failuresDetected) * 100) : 0}%
                </span>
              </div>
              <div class="flex justify-between">
                <span>Attempt to success rate</span>
                <span class="text-v2-text-text-base">{successRate()}%</span>
              </div>
            </div>
          </div>

          <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
            <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">Failure Classification</h3>
            <DonutChart data={failureClassification()} />
          </div>
        </div>
      </Show>
    </section>
  )
}
