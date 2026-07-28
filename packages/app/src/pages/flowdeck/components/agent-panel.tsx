import type { AggregatedFlowdeckStats } from "../parsers/session-parser"
import { StatCard } from "./stat-card"
import { BarChart, DonutChart } from "./activity-chart"

type AgentPanelProps = {
  stats: AggregatedFlowdeckStats
}

export function AgentPanel(props: AgentPanelProps) {
  const agentData = () => {
    return Object.entries(props.stats.agentBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, count]) => ({ label: name, value: count }))
  }

  const totalDelegations = () =>
    Object.values(props.stats.agentBreakdown).reduce((sum, c) => sum + c, 0)

  const heidiCount = () => props.stats.agentBreakdown["heidi"] ?? 0
  const specialistCount = () => totalDelegations() - heidiCount()

  const donutData = () => {
    const entries = Object.entries(props.stats.agentBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
    return entries.map(([name, count]) => ({ label: name, value: count }))
  }

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  const totalTokens = () =>
    props.stats.totalTokens.input + props.stats.totalTokens.output + props.stats.totalTokens.reasoning

  return (
    <section class="flex flex-col gap-4">
      <h2 class="text-14-emphasis text-v2-text-text-strong">Agent Activity</h2>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Delegations" value={totalDelegations()} sublabel="agent invocations" />
        <StatCard
          label="Heidi (Primary)"
          value={heidiCount()}
          sublabel={totalDelegations() > 0 ? `${Math.round((heidiCount() / totalDelegations()) * 100)}% of work` : "no data"}
        />
        <StatCard
          label="Specialists"
          value={specialistCount()}
          sublabel={`${Object.keys(props.stats.agentBreakdown).length} unique agents`}
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(totalTokens())}
          sublabel={`$${props.stats.totalCost.toFixed(4)} cost`}
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
          <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">Agent Usage Frequency</h3>
          <BarChart data={agentData()} />
        </div>

        <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
          <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">Delegation Distribution</h3>
          <DonutChart data={donutData()} />
          <div class="mt-4 grid grid-cols-3 gap-2 text-center text-11-regular">
            <div>
              <div class="text-14-emphasis text-v2-text-text-strong">{formatTokens(props.stats.totalTokens.input)}</div>
              <div class="text-v2-text-text-muted">Input</div>
            </div>
            <div>
              <div class="text-14-emphasis text-v2-text-text-strong">{formatTokens(props.stats.totalTokens.output)}</div>
              <div class="text-v2-text-text-muted">Output</div>
            </div>
            <div>
              <div class="text-14-emphasis text-v2-text-text-strong">{formatTokens(props.stats.totalTokens.reasoning)}</div>
              <div class="text-v2-text-text-muted">Reasoning</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
