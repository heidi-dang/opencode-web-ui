import { createEffect, onCleanup, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { type FleetServerSnapshot } from "../fleet-types"
import { formatRelativeTime, formatLatency, formatVersion } from "../fleet-format"
import { FleetStatusBadge } from "./fleet-status-badge"

interface DetailDrawerProps {
  server: () => FleetServerSnapshot | null
  onClose: () => void
  onRefresh: (key: string) => void
  variant?: "sidebar" | "overlay"
}

function SectionHeading(props: { title: string }) {
  return <h4 class="text-xs font-semibold uppercase tracking-wide text-v2-text-text-muted mb-2">{props.title}</h4>
}

function DetailRow(props: { label: string; value: string; monospace?: boolean }) {
  return (
    <tr>
      <td class="py-1 pr-3 text-v2-text-text-muted w-28 align-top text-xs">{props.label}</td>
      <td class={`text-xs ${props.monospace ? "font-mono tabular-nums" : ""} break-all`}>{props.value}</td>
    </tr>
  )
}

function CopyButton(props: { value: string; label: string }) {
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard not available */ }
  }
  return (
    <button class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-background-bg-layer-02 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
            onClick={copy}
            aria-label={`Copy ${props.label}`}>
      {copied() ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6l2.5 2.5 4.5-5"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="2.5" width="6" height="7.5" rx="1" stroke="currentColor"/><path d="M2 4.5v5A1.5 1.5 0 003.5 11h5"/></svg>
      )}
      <span>{copied() ? "Copied!" : "Copy"}</span>
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
  const variant = () => props.variant ?? "overlay"

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

  // Lock body scroll when overlay drawer is open
  createEffect(() => {
    const open = isOpen()
    const v = variant()
    if (typeof document !== "undefined") {
      if (open && v === "overlay") {
        document.body.style.overflow = "hidden"
      } else if (v === "overlay") {
        document.body.style.overflow = ""
      }
    }
    onCleanup(() => {
      if (typeof document !== "undefined" && v === "overlay") {
        document.body.style.overflow = ""
      }
    })
  })

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

  const drawerContent = () => {
    const snap = props.server()
    if (!snap) return null

    return (
      <>
        {/* Header */}
        <div class="flex items-center justify-between border-b border-v2-border-border-base/50 bg-v2-background-bg-layer-01/50 px-5 py-4 shrink-0">
          <h3 class="truncate text-base font-semibold tracking-tight">{serverName()}</h3>
          <button ref={closeBtnRef}
                  class="inline-flex items-center justify-center rounded-md p-2 text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base transition-colors focus-visible:outline-2 focus-visible:outline-ring min-h-[36px] min-w-[36px]"
                  onClick={onClose}
                  aria-label={t("fleet.drawer.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div class="flex-1 overflow-y-auto p-5 space-y-8 text-sm">
          {/* Status & Quick Actions */}
          <section aria-labelledby="drawer-section-quick-actions" class="space-y-4">
            <div class="flex items-center gap-2">
              <FleetStatusBadge state={snap.health.state} latencyMs={snap.health.latencyMs} />
            </div>
            <div class="flex flex-col sm:flex-row gap-2">
              <button class="inline-flex flex-1 items-center gap-2 justify-center rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 px-3 py-2 text-xs font-medium hover:bg-v2-background-bg-layer-02 transition-colors focus-visible:outline-2 focus-visible:outline-ring shadow-sm"
                      onClick={() => props.onRefresh(snap.key)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                {t("fleet.drawer.refresh")}
              </button>
              <button class="inline-flex flex-1 items-center gap-2 justify-center rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 px-3 py-2 text-xs font-medium hover:bg-v2-background-bg-layer-02 transition-colors focus-visible:outline-2 focus-visible:outline-ring shadow-sm"
                      onClick={() => window.open(snap.url, '_blank', 'noopener')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                {t("fleet.drawer.openInNewTab")}
              </button>
            </div>
          </section>

          {/* Details */}
          <section aria-labelledby="drawer-section-details">
            <SectionHeading title={t("fleet.drawer.overview")} />
            <div class="rounded-xl border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/20 overflow-hidden">
              <table class="w-full text-sm">
                <tbody class="divide-y divide-border/30">
                  <tr class="hover:bg-v2-background-bg-layer-02/30 transition-colors">
                    <td class="py-2.5 pl-4 pr-2 text-v2-text-text-muted w-1/3 text-xs align-middle">{t("fleet.label.url")}</td>
                    <td class="py-2.5 pr-4 text-xs font-mono tabular-nums break-all align-middle text-v2-text-text-base">{snap.url}</td>
                  </tr>
                  <tr class="hover:bg-v2-background-bg-layer-02/30 transition-colors">
                    <td class="py-2.5 pl-4 pr-2 text-v2-text-text-muted w-1/3 text-xs align-middle">{t("fleet.label.connection")}</td>
                    <td class="py-2.5 pr-4 text-xs font-medium align-middle text-v2-text-text-base">{snap.connectionType.toUpperCase()}</td>
                  </tr>
                  <tr class="hover:bg-v2-background-bg-layer-02/30 transition-colors">
                    <td class="py-2.5 pl-4 pr-2 text-v2-text-text-muted w-1/3 text-xs align-middle">{t("fleet.label.protocol")}</td>
                    <td class="py-2.5 pr-4 text-xs font-medium align-middle text-v2-text-text-base">{snap.protocol.kind ? `v${snap.protocol.kind}` : t("fleet.value.unavailable")}</td>
                  </tr>
                  <tr class="hover:bg-v2-background-bg-layer-02/30 transition-colors">
                    <td class="py-2.5 pl-4 pr-2 text-v2-text-text-muted w-1/3 text-xs align-middle">{t("fleet.label.version")}</td>
                    <td class="py-2.5 pr-4 text-xs font-mono tabular-nums align-middle text-v2-text-text-base">{formatVersion(snap.health.version)}</td>
                  </tr>
                  <tr class="hover:bg-v2-background-bg-layer-02/30 transition-colors">
                    <td class="py-2.5 pl-4 pr-2 text-v2-text-text-muted w-1/3 text-xs align-middle">{t("fleet.label.lastCheck")}</td>
                    <td class="py-2.5 pr-4 text-xs align-middle text-v2-text-text-base">{snap.health.checkedAt ? formatRelativeTime(snap.health.checkedAt) : t("fleet.value.unavailable")}</td>
                  </tr>
                  <tr class="hover:bg-v2-background-bg-layer-02/30 transition-colors">
                    <td class="py-2.5 pl-4 pr-2 text-v2-text-text-muted w-1/3 text-xs align-middle">{t("fleet.label.latency")}</td>
                    <td class="py-2.5 pr-4 text-xs font-mono tabular-nums align-middle text-green-500">{snap.health.latencyMs !== undefined ? formatLatency(snap.health.latencyMs) : t("fleet.value.unavailable")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Workload */}
          <section aria-labelledby="drawer-section-workload">
            <SectionHeading title="Workload & Resources" />
            <div class="rounded-xl border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/20 overflow-hidden">
              <div class="divide-y divide-border/30">
                <div class="flex items-center justify-between py-2.5 px-4 hover:bg-v2-background-bg-layer-02/30 transition-colors">
                  <span class="text-xs text-v2-text-text-muted">{t("fleet.drawer.projects")}</span>
                  <span class="text-xs font-mono tabular-nums text-v2-text-text-base">{snap.projects.open} / {snap.projects.known}</span>
                </div>
                <div class="flex items-center justify-between py-2.5 px-4 hover:bg-v2-background-bg-layer-02/30 transition-colors">
                  <span class="text-xs text-v2-text-text-muted">{t("fleet.drawer.providers")}</span>
                  <span class="text-xs font-mono tabular-nums text-v2-text-text-base">{snap.providers.connected} / {snap.providers.configured}</span>
                </div>
                <div class="py-2.5 px-4 hover:bg-v2-background-bg-layer-02/30 transition-colors">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-medium text-v2-text-text-base">{t("fleet.drawer.sessions")}</span>
                    <span class="text-xs font-mono tabular-nums font-semibold text-v2-text-text-base">{snap.sessions.totalActive} Active</span>
                  </div>
                  <div class="space-y-1.5 pl-2 border-l-2 border-v2-border-border-base/50">
                    <div class="flex justify-between text-xs">
                      <span class="text-v2-text-text-muted">{t("fleet.drawer.running")}</span>
                      <span class="font-mono tabular-nums text-v2-text-text-base">{snap.sessions.running}</span>
                    </div>
                    <div class="flex justify-between text-xs">
                      <span class="text-v2-text-text-muted">{t("fleet.drawer.busy")}</span>
                      <span class="font-mono tabular-nums text-v2-text-text-base">{snap.sessions.busy}</span>
                    </div>
                    {snap.sessions.permissionBlocked > 0 && (
                      <div class="flex justify-between text-xs text-amber-500">
                        <span>{t("fleet.drawer.permissionBlocked")}</span>
                        <span class="font-mono tabular-nums">{snap.sessions.permissionBlocked}</span>
                      </div>
                    )}
                    {snap.sessions.questionBlocked > 0 && (
                      <div class="flex justify-between text-xs text-amber-500">
                        <span>{t("fleet.drawer.questionBlocked")}</span>
                        <span class="font-mono tabular-nums">{snap.sessions.questionBlocked}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="pb-4">
             <CopyButton value={snap.url} label={t("fleet.label.url")} />
          </div>
        </div>
      </>
    )
  }

  // Sidebar variant (desktop) — no backdrop, no fixed positioning
  if (variant() === "sidebar") {
    return (
      <div
        ref={panelRef}
        class="h-full flex flex-col bg-v2-background-bg-base"
        role="dialog"
        aria-modal="false"
        aria-label={t("fleet.drawer.title")}
      >
        {drawerContent()}
      </div>
    )
  }

  // Overlay variant (tablet/mobile) — backdrop + fixed positioning
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("fleet.drawer.title")}
      class={`fixed inset-0 z-50 ${isOpen() ? "" : "pointer-events-none"}`}
      style={{ visibility: isOpen() ? "visible" : "hidden" }}
    >
      <div class="absolute inset-0 bg-black/30" onClick={onBackdropClick} />
      <div
        ref={panelRef}
        class="absolute inset-y-0 right-0 w-full max-w-md bg-v2-background-bg-base shadow-xl flex flex-col border-l safe-area-padding"
      >
        {drawerContent()}
      </div>
    </div>
  )
}
