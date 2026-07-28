import { createEffect, onCleanup, createMemo, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { type FleetServerSnapshot } from "../fleet-types"
import { formatRelativeTime, formatLatency, formatVersion } from "../fleet-format"
import { FleetStatusBadge } from "./fleet-status-badge"

interface DetailDrawerProps {
  server: () => FleetServerSnapshot | null
  onClose: () => void
  onRefresh: (key: string) => void
}

function SectionHeading(props: { title: string }) {
  return <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{props.title}</h4>
}

function DetailRow(props: { label: string; value: string; class?: string; monospace?: boolean }) {
  return (
    <tr>
      <td class="py-1 pr-3 text-muted-foreground w-28 align-top text-xs">{props.label}</td>
      <td class={`text-xs ${props.monospace ? "font-mono tabular-nums" : ""} ${props.class ?? ""} break-all`}>{props.value}</td>
    </tr>
  )
}

function CopyButton(props: { value: string; label: string }) {
  const { t } = useLanguage()
  const [copied, setCopied] = createSignal(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard not available */ }
  }

  return (
    <button class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-2 focus-visible:outline-ring"
            onClick={copy}
            aria-label={`${t("fleet.drawer.copyToClipboard")} ${props.label}`}>
      {copied() ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6l2.5 2.5 4.5-5"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="2.5" width="6" height="7.5" rx="1" stroke="currentColor"/><path d="M2 4.5v5A1.5 1.5 0 003.5 11h5"/></svg>
      )}
      <span>{copied() ? t("fleet.drawer.copied") : t("fleet.drawer.copy")}</span>
    </button>
  )
}

/** Tab-trap helper */
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
        class="absolute inset-y-0 right-0 w-full max-w-md bg-background shadow-xl flex flex-col border-l safe-area-padding"
      >
        {/* Header */}
        <div class="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <h3 class="truncate text-sm font-semibold">{serverName()}</h3>
          <button ref={closeBtnRef}
                  class="inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring min-h-[36px] min-w-[36px]"
                  onClick={onClose}
                  aria-label={t("fleet.drawer.close")}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M4 4l8 8M12 4l-8 8"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div class="flex-1 overflow-y-auto p-4 space-y-6 text-sm">
          {(() => {
            const snap = props.server()
            if (!snap) return null
            return (
              <>
                {/* Section: Overview */}
                <section aria-labelledby="drawer-section-overview">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-sm font-semibold">{snap.name}</span>
                    <FleetStatusBadge state={snap.health.state} latencyMs={snap.health.latencyMs} />
                  </div>
                  <SectionHeading title={t("fleet.drawer.overview")} />
                  <table class="w-full">
                    <tbody>
                      <DetailRow label={t("fleet.label.url")} value={snap.url} />
                      {snap.label ? <DetailRow label={t("fleet.label.label")} value={snap.label} /> : null}
                    </tbody>
                  </table>
                </section>

                {/* Section: Connection */}
                <section aria-labelledby="drawer-section-connection">
                  <SectionHeading title={t("fleet.drawer.connection")} />
                  <table class="w-full">
                    <tbody>
                      <DetailRow label={t("fleet.label.connection")} value={snap.connectionType.toUpperCase()} />
                      <DetailRow label={t("fleet.label.protocol")} value={snap.protocol.kind ? `v${snap.protocol.kind}` : t("fleet.value.unavailable")} />
                    </tbody>
                  </table>
                  <div class="mt-1">
                    <CopyButton value={snap.url} label={t("fleet.label.url")} />
                  </div>
                </section>

                {/* Section: Health */}
                <section aria-labelledby="drawer-section-health">
                  <SectionHeading title={t("fleet.drawer.health")} />
                  <table class="w-full">
                    <tbody>
                      <DetailRow label={t("fleet.label.version")} value={formatVersion(snap.health.version)} />
                      <DetailRow label={t("fleet.label.latency")} value={snap.health.latencyMs !== undefined ? formatLatency(snap.health.latencyMs) : t("fleet.value.unavailable")} monospace />
                      <DetailRow label={t("fleet.label.lastCheck")} value={formatRelativeTime(snap.health.checkedAt)} />
                    </tbody>
                  </table>
                </section>

                {/* Section: Projects & Providers */}
                <section aria-labelledby="drawer-section-projects">
                  <SectionHeading title={t("fleet.drawer.projects")} />
                  <div class="text-xs text-muted-foreground">
                    {t("fleet.drawer.projectsCount", { open: String(snap.projects.open), known: String(snap.projects.known) })}
                  </div>
                </section>
                <section aria-labelledby="drawer-section-providers">
                  <SectionHeading title={t("fleet.drawer.providers")} />
                  <div class="text-xs text-muted-foreground">
                    {t("fleet.drawer.providersCount", { connected: String(snap.providers.connected), configured: String(snap.providers.configured) })}
                  </div>
                </section>

                {/* Section: Sessions */}
                <section aria-labelledby="drawer-section-sessions">
                  <SectionHeading title={t("fleet.drawer.sessions")} />
                  <div class="space-y-1 text-xs">
                    <div class="flex justify-between"><span class="text-muted-foreground">{t("fleet.drawer.running")}</span><span class="font-mono tabular-nums">{snap.sessions.running}</span></div>
                    <div class="flex justify-between"><span class="text-muted-foreground">{t("fleet.drawer.busy")}</span><span class="font-mono tabular-nums">{snap.sessions.busy}</span></div>
                    {snap.sessions.permissionBlocked > 0 && (
                      <div class="flex justify-between text-amber-500"><span>{t("fleet.drawer.permissionBlocked")}</span><span class="font-mono tabular-nums">{snap.sessions.permissionBlocked}</span></div>
                    )}
                    {snap.sessions.questionBlocked > 0 && (
                      <div class="flex justify-between text-amber-500"><span>{t("fleet.drawer.questionBlocked")}</span><span class="font-mono tabular-nums">{snap.sessions.questionBlocked}</span></div>
                    )}
                    <div class="flex justify-between font-medium border-t pt-1 mt-1"><span>{t("fleet.drawer.totalActive")}</span><span class="font-mono tabular-nums">{snap.sessions.totalActive}</span></div>
                  </div>
                </section>

                {/* Section: Actions */}
                <section aria-labelledby="drawer-section-actions">
                  <SectionHeading title={t("fleet.drawer.actions")} />
                  <div class="flex flex-wrap gap-2">
                    <button class="inline-flex items-center gap-1.5 justify-center rounded px-3 py-1.5 text-xs font-medium bg-accent hover:bg-accent/80 transition-colors focus-visible:outline-2 focus-visible:outline-ring min-h-[36px]"
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
