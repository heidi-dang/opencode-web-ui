
import { createEffect, onCleanup, createMemo } from "solid-js"
import { type FleetServerSnapshot } from "../fleet-types"
import { formatRelativeTime, formatVersion } from "../fleet-format"
import { FleetStatusBadge } from "./fleet-status-badge"

interface DetailDrawerProps {
  server: () => FleetServerSnapshot | null
  onClose: () => void
  onRefresh: (key: string) => void
}

function SectionHeading(props: { title: string }) {
  return <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{props.title}</h4>
}

function DetailRow(props: { label: string; value: string; class?: string }) {
  return (
    <tr>
      <td class="py-0.5 pr-3 text-muted-foreground w-28">{props.label}</td>
      <td class={props.class ?? ""}>{props.value}</td>
    </tr>
  )
}

export function FleetDetailDrawer(props: DetailDrawerProps) {
  // Reactive null guard — re-evaluates on every render
  const isOpen = createMemo(() => props.server() !== null)

  // Focus trap: focus first focusable element on open
  let dialogRef: HTMLDivElement | undefined
  let closeBtnRef: HTMLButtonElement | undefined

  createEffect(() => {
    if (isOpen() && closeBtnRef) {
      closeBtnRef.focus()
    }
  })

  // Escape key
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && isOpen()) {
      props.onClose()
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => document.removeEventListener("keydown", onKeyDown))
  }

  // Backdrop click closes
  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      props.onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Server details"
      class={`fixed inset-0 z-50 ${isOpen() ? "" : "pointer-events-none"}`}
      style={{ visibility: isOpen() ? "visible" : "hidden" }}
    >
      {/* Backdrop */}
      <div class="absolute inset-0 bg-black/30" onClick={onBackdropClick} />

      {/* Drawer panel */}
      <div
        ref={dialogRef}
        class="absolute inset-y-0 right-0 w-full max-w-md bg-background shadow-xl flex flex-col border-l"
        role="document"
      >
        {/* Header */}
        <div class="flex items-center justify-between border-b px-4 py-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="truncate text-sm font-semibold">{/* Reactive value from props.server() */}</span>
          </div>
          <button ref={closeBtnRef}
                  class="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent"
                  onClick={props.onClose}
                  aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4l8 8M12 4l-8 8"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div class="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
          {(function () {
            const s = props.server()
            if (!s) return null
            return (
              <>
                {/* Section 1: Overview */}
                <section>
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-sm font-semibold">{s.name}</span>
                    <FleetStatusBadge state={s.health.state} latencyMs={s.health.latencyMs} />
                  </div>
                  <SectionHeading title="Overview" />
                  <table class="w-full text-xs">
                    <tbody>
                      <DetailRow label="URL" value={s.url} />
                      {s.label ? <DetailRow label="Label" value={s.label} /> : null}
                      <DetailRow label="Connection" value={s.connectionType.toUpperCase()} />
                      <DetailRow label="Protocol" value={s.protocol.kind ? `v${s.protocol.kind}` : "\u2014"} />
                      <DetailRow label="Version" value={formatVersion(s.health.version)} />
                      <DetailRow label="Latency" value={s.health.latencyMs !== undefined ? `~${s.health.latencyMs}ms` : "\u2014"} />
                      <DetailRow label="Last check" value={formatRelativeTime(s.health.checkedAt)} />
                    </tbody>
                  </table>
                </section>

                {/* Section 2: Projects */}
                <section>
                  <SectionHeading title="Projects" />
                  <div class="text-xs text-muted-foreground">
                    {s.projects.open} open &middot; {s.projects.known} known on server
                  </div>
                </section>

                {/* Section 3: Sessions */}
                <section>
                  <SectionHeading title="Sessions" />
                  <div class="space-y-1 text-xs">
                    <div class="flex justify-between"><span>Running</span><span class="font-mono">{s.sessions.running}</span></div>
                    <div class="flex justify-between"><span>Busy</span><span class="font-mono">{s.sessions.busy}</span></div>
                    {s.sessions.permissionBlocked > 0 && (
                      <div class="flex justify-between text-amber-500"><span>Permission blocked</span><span class="font-mono">{s.sessions.permissionBlocked}</span></div>
                    )}
                    {s.sessions.questionBlocked > 0 && (
                      <div class="flex justify-between text-amber-500"><span>Question blocked</span><span class="font-mono">{s.sessions.questionBlocked}</span></div>
                    )}
                    <div class="flex justify-between font-medium border-t pt-1 mt-1"><span>Total active</span><span class="font-mono">{s.sessions.totalActive}</span></div>
                  </div>
                </section>

                {/* Section 4: Providers */}
                <section>
                  <SectionHeading title="Providers" />
                  <div class="text-xs text-muted-foreground">
                    {s.providers.connected} connected &middot; {s.providers.configured} configured
                  </div>
                </section>

                {/* Section 5: Diagnostics */}
                <section>
                  <SectionHeading title="Diagnostics" />
                  <div class="flex gap-2 mt-2">
                    <button class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium bg-accent hover:bg-accent/80"
                            onClick={() => props.onRefresh(s.key)}>
                      Refresh Health
                    </button>
                  </div>
                </section>
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
