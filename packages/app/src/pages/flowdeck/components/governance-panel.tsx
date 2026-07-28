import type { AggregatedFlowdeckStats } from "../parsers/session-parser"
import type { AuditSummary } from "../parsers/audit-parser"
import { StatCard } from "./stat-card"
import { BarChart, StackedBar } from "./activity-chart"

type GovernancePanelProps = {
  stats: AggregatedFlowdeckStats
  audit?: AuditSummary
}

export function GovernancePanel(props: GovernancePanelProps) {
  const toolData = () => {
    const entries = Object.entries(props.stats.toolBreakdown)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
    return entries.map(([name, counts]) => ({
      label: name.replace("fdx-", ""),
      value: counts.total,
    }))
  }

  const governanceSegments = () => {
    const gov = props.audit
      ? { blocked: props.audit.blocked, warned: props.audit.warned, approved: props.audit.approved }
      : props.stats.governance
    return [
      { label: "Approved", value: gov.approved, color: "var(--v2-status-success-fg)" },
      { label: "Warned", value: gov.warned, color: "var(--v2-status-warning-fg)" },
      { label: "Blocked", value: gov.blocked, color: "var(--v2-status-danger-fg)" },
    ]
  }

  const totalDecisions = () => {
    const gov = props.audit
      ? { blocked: props.audit.blocked, warned: props.audit.warned, approved: props.audit.approved }
      : props.stats.governance
    return gov.blocked + gov.warned + gov.approved
  }

  const errorRate = () =>
    props.stats.totalToolCalls > 0 ? ((props.stats.totalToolErrors / props.stats.totalToolCalls) * 100).toFixed(1) : "0"

  return (
    <section class="flex flex-col gap-4">
      <h2 class="text-14-emphasis text-v2-text-text-strong">Governance & Audit</h2>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Tool Calls" value={props.stats.totalToolCalls} sublabel="FlowDeck tools" />
        <StatCard
          label="Error Rate"
          value={`${errorRate()}%`}
          accent={props.stats.totalToolErrors > 0 ? "warning" : "success"}
          sublabel={`${props.stats.totalToolErrors} errors`}
        />
        <StatCard
          label="Blocked"
          value={props.audit?.blocked ?? props.stats.governance.blocked}
          accent="danger"
          sublabel="governance blocks"
        />
        <StatCard
          label="Delegation Violations"
          value={props.audit?.delegationViolations ?? 0}
          accent={props.audit && props.audit.delegationViolations > 0 ? "warning" : "default"}
        />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
          <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">Tool Call Volume</h3>
          <BarChart data={toolData()} />
        </div>

        <div class="rounded-md border border-v2-border-border-default bg-v2-background-bg-raised p-4">
          <h3 class="mb-3 text-12-emphasis text-v2-text-text-base">
            Governance Decisions ({totalDecisions()})
          </h3>
          <StackedBar segments={governanceSegments()} />
          <div class="mt-4 grid grid-cols-2 gap-2 text-11-regular text-v2-text-text-muted">
            <div>
              Budget exceedances:{" "}
              <span class="text-v2-text-text-base">{props.audit?.budgetExceedances ?? 0}</span>
            </div>
            <div>
              Audit events: <span class="text-v2-text-text-base">{props.audit?.total ?? "N/A"}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
