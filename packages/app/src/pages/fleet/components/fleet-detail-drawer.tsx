import { createEffect, onCleanup, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
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

/** Tab-trap helper: cycles Tab/Shift+Tab inside the container */
function createTabTrap(container: () => HTMLElement | undefined) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !container()) return
    const focusable = container()!.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus() }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }
}

export function FleetDetailDrawer(props: DetailDrawerProps) {
  const { t } = useLanguage()
  const isOpen = createMemo(() => props.server() !== null)
  const serverName = createMemo(() => props.server()?.name ?? "")

  let dialogRef: HTMLDivElement | undefined
  let panelRef: HTMLDivElement | undefined
  let closeBtnRef: HTMLButtonElement | undefined
  let triggerRef: HTMLElement | undefined

  const onTabTrap = createTabTrap(() => panelRef)

  createEffect(() => {
    if (isOpen() && closeBtnRef) {
      triggerRef = document.activeElement as HTMLElement
      closeBtnRef.focus()
    }
  })

  const onClose = () => {
    props.onClose()
    setTimeout(() => triggerRef?.focus(), 0)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && isOpen()) {
      e.preventDefault()
      onClose()
      return
    }
    onTabTrap(e)
  }

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => document.removeEventListener("keydown", onKeyDown))
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  const s = (): FleetServerSnapshot | null => props.server()

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("fleet.drawer.title")}
      class={`fixed inset-0 z-50 ${isOpen() ? "" : "pointer-events-none"}`}
      style={{ visibility: isOpen() ? "visible" : "hidden" }}
    >
      <div class="absolute inset-0 bg-black/30" onClick={onBackdropClick} />
      <div
        ref={panelRef}
        class="absolute inset-y-0 right-0 w-full max-w-md bg-background shadow-xl flex flex-col border-l"
      >
        <div class="flex items-center justify-between border-b px-4 py-3">
          <h3 class="truncate text-sm font-semibold">{serverName()}</h3>
          <button ref={closeBtnRef}
                  class="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent"
                  onClick={onClose}
                  aria-label={t("fleet.drawer.close")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4l8 8M12 4l-8 8"/>
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
          {(() => {
            const snap = s()
            if (!snap) return null
            return (
              <>
                <section>
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-sm font-semibold">{snap.name}</span>
                    <FleetStatusBadge state={snap.health.state} latencyMs={snap.health.latencyMs} />
                  </div>
                  <SectionHeading title={t("fleet.drawer.overview")} />
                  <table class="w-full text-xs">
                    <tbody>
                      <DetailRow label={t("fleet.label.url")} value={snap.url} />
                      {snap.label ? <DetailRow label={t("fleet.label.label")} value={snap.label} /> : null}
                      <DetailRow label={t("fleet.label.connection")} value={snap.connectionType.toUpperCase()} />
                      <DetailRow label={t("fleet.label.protocol")} value={snap.protocol.kind ? `v${snap.protocol.kind}` : "\u2014"} />
                      <DetailRow label={t("fleet.label.version")} value={formatVersion(snap.health.version)} />
                      <DetailRow label={t("fleet.label.latency")} value={snap.health.latencyMs !== undefined ? `~${snap.health.latencyMs}ms` : "\u2014"} />
                      <DetailRow label={t("fleet.label.lastCheck")} value={formatRelativeTime(snap.health.checkedAt)} />
                    </tbody>
                  </table>
                </section>
                <section>
                  <SectionHeading title={t("fleet.drawer.projects")} />
                  <div class="text-xs text-muted-foreground">
                    {t("fleet.drawer.projectsCount", { open: String(snap.projects.open), known: String(snap.projects.known) })}
                  </div>
                </section>
                <section>
                  <SectionHeading title={t("fleet.drawer.sessions")} />
                  <div class="space-y-1 text-xs">
                    <div class="flex justify-between"><span>{t("fleet.drawer.running")}</span><span class="font-mono">{snap.sessions.running}</span></div>
                    <div class="flex justify-between"><span>{t("fleet.drawer.busy")}</span><span class="font-mono">{snap.sessions.busy}</span></div>
                    {snap.sessions.permissionBlocked > 0 && (
                      <div class="flex justify-between text-amber-500"><span>{t("fleet.drawer.permissionBlocked")}</span><span class="font-mono">{snap.sessions.permissionBlocked}</span></div>
                    )}
                    {snap.sessions.questionBlocked > 0 && (
                      <div class="flex justify-between text-amber-500"><span>{t("fleet.drawer.questionBlocked")}</span><span class="font-mono">{snap.sessions.questionBlocked}</span></div>
                    )}
                    <div class="flex justify-between font-medium border-t pt-1 mt-1"><span>{t("fleet.drawer.totalActive")}</span><span class="font-mono">{snap.sessions.totalActive}</span></div>
                  </div>
                </section>
                <section>
                  <SectionHeading title={t("fleet.drawer.providers")} />
                  <div class="text-xs text-muted-foreground">
                    {t("fleet.drawer.providersCount", { connected: String(snap.providers.connected), configured: String(snap.providers.configured) })}
                  </div>
                </section>
                <section>
                  <SectionHeading title={t("fleet.drawer.diagnostics")} />
                  <div class="flex gap-2 mt-2">
                    <button class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium bg-accent hover:bg-accent/80"
                            onClick={() => props.onRefresh(snap.key)}>
                      {t("fleet.drawer.refresh")}
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
