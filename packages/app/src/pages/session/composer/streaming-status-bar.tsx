import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useParams } from "@solidjs/router"
import { useSettings } from "@/context/settings"

import { useLanguage } from "@/context/language"

export type ActivityHint = "thinking" | "tool" | "shell" | "file" | "text" | "step"

function getPhrases(lang: ReturnType<typeof useLanguage>, hint: ActivityHint): readonly string[] {
  switch (hint) {
    case "tool": return [lang.t("session.status.tool.1"), lang.t("session.status.tool.2"), lang.t("session.status.tool.3")]
    case "shell": return [lang.t("session.status.shell.1"), lang.t("session.status.shell.2"), lang.t("session.status.shell.3")]
    case "file": return [lang.t("session.status.file.1"), lang.t("session.status.file.2"), lang.t("session.status.file.3")]
    case "text": return [lang.t("session.status.text.1"), lang.t("session.status.text.2"), lang.t("session.status.text.3")]
    case "step": return [lang.t("session.status.step.1"), lang.t("session.status.step.2"), lang.t("session.status.step.3")]
    default: return [lang.t("session.status.working.1"), lang.t("session.status.working.2"), lang.t("session.status.working.3")]
  }
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}



interface StreamingStatusBarProps {
  activityHint?: ActivityHint
}

/**
 * Animated status bar shown only in the V2 new layout while the AI is working.
 * Shows contextual cycling phrases, a pulsing dot, and an elapsed timer.
 */
export function StreamingStatusBar(props: StreamingStatusBarProps) {
  const sync = useSync()
  const params = useParams<{ id: string }>()
  const settings = useSettings()

  const isV2 = createMemo(() => settings.general.newLayoutDesigns())
  const isWorking = createMemo(() => sync().data.session_working(params.id ?? ""))

  return (
    <Show when={isV2() && isWorking()}>
      <StreamingStatusBarInner activityHint={props.activityHint ?? "thinking"} />
    </Show>
  )
}

function StreamingStatusBarInner(props: { activityHint: ActivityHint }) {
  const language = useLanguage()

  const [phrase, setPhrase] = createSignal<string>(pick(getPhrases(language, props.activityHint)))
  const [phraseFading, setPhraseFading] = createSignal(false)
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0)
  const [isMounted, setIsMounted] = createSignal(false)

  const startTime = Date.now()
  let elapsedInterval: ReturnType<typeof setInterval> | undefined
  let phraseInterval: ReturnType<typeof setInterval> | undefined

  const cyclePhrase = () => {
    setPhraseFading(true)
    setTimeout(() => {
      setPhrase(pick(getPhrases(language, props.activityHint)))
      setPhraseFading(false)
    }, 250)
  }

  // Slight delay before showing to avoid flash on quick completions
  const mountTimer = setTimeout(() => setIsMounted(true), 300)
  elapsedInterval = setInterval(() => {
    setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
  }, 1000)
  phraseInterval = setInterval(cyclePhrase, 3500)

  createEffect(
    on(
      () => props.activityHint,
      (hint, prev) => {
        if (hint !== prev) cyclePhrase()
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    clearTimeout(mountTimer)
    if (elapsedInterval !== undefined) clearInterval(elapsedInterval)
    if (phraseInterval !== undefined) clearInterval(phraseInterval)
  })

  return (
    <div
      class="streaming-status-bar"
      data-component="streaming-status-bar"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        padding: "5px 12px",
        opacity: isMounted() ? "1" : "0",
        transition: "opacity 0.5s ease",
        "border-radius": "8px 8px 0 0",
        "min-height": "30px",
        overflow: "hidden",
        "margin-bottom": "-1px",
      }}
      role="status"
      aria-live="polite"
      aria-label={language.t("session.status.accessibleName")}
    >
      {/* Animated indigo activity dot */}
      <div style={{ "flex-shrink": "0", display: "flex", "align-items": "center", "justify-content": "center" }}>
        <div
          class="status-pulse-emerald"
          style={{
            width: "6px",
            height: "6px",
            "border-radius": "50%",
            background: "rgba(99, 102, 241, 0.9)",
            "flex-shrink": "0",
          }}
        />
      </div>

      {/* Status phrase — shown on larger screens */}
      <div class="status-text-verbose" style={{ flex: "1", overflow: "hidden" }}>
        <span
          class={phraseFading() ? "status-phrase-exit" : "status-phrase-enter"}
          style={{
            display: "block",
            "font-size": "11.5px",
            "line-height": "1.4",
            color: "var(--v2-text-text-muted, rgba(160, 160, 180, 0.85))",
            "letter-spacing": "0.01em",
            "white-space": "nowrap",
            overflow: "hidden",
            "text-overflow": "ellipsis",
          }}
          aria-hidden="true"
        >
          {phrase()}
        </span>
      </div>

      {/* Compact label — shown on mobile */}
      <div
        class="status-text-compact"
        style={{ flex: "1", "align-items": "center", gap: "4px", overflow: "hidden" }}
      >
        <span
          style={{
            "font-size": "11px",
            color: "var(--v2-text-text-muted, rgba(140, 140, 160, 0.8))",
            "white-space": "nowrap",
          }}
          aria-hidden="true"
        >
          {language.t("session.status.workingCompact")}
        </span>
      </div>

      {/* Elapsed timer */}
      <Show when={elapsedSeconds() > 0}>
        <span
          class="elapsed-timer"
          style={{
            "flex-shrink": "0",
            "font-size": "11px",
            color: "var(--v2-text-text-faint, rgba(120, 120, 140, 0.65))",
            "white-space": "nowrap",
          }}
          aria-hidden="true"
        >
          {formatElapsed(elapsedSeconds())}
        </span>
      </Show>
    </div>
  )
}
