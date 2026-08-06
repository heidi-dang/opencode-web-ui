import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { useSync } from "@/context/sync"
import { useParams } from "@solidjs/router"
import { useSettings } from "@/context/settings"
import { NumberTicker } from "@/components/ui/number-ticker"
import { useLanguage } from "@/context/language"
import { createMediaQuery } from "@solid-primitives/media"
import { ModelActivityWaveform } from "./model-activity-waveform"

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

const tokenFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})

interface StreamingStatusBarProps {
  activityHint?: ActivityHint
}

/**
 * Animated status bar shown only in the V2 new layout while the AI is working.
 * Shows contextual cycling phrases, a live activity waveform, and an elapsed timer.
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
  const compact = createMediaQuery("(max-width: 640px)")

  const startTime = Date.now()
  let elapsedInterval: ReturnType<typeof setInterval> | undefined
  let phraseInterval: ReturnType<typeof setInterval> | undefined
  let phraseTimer: ReturnType<typeof setTimeout> | undefined

  const cyclePhrase = () => {
    if (phraseTimer !== undefined) clearTimeout(phraseTimer)
    setPhraseFading(true)
    phraseTimer = setTimeout(() => {
      phraseTimer = undefined
      setPhrase(pick(getPhrases(language, props.activityHint)))
      setPhraseFading(false)
    }, 250)
  }

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
    if (phraseTimer !== undefined) clearTimeout(phraseTimer)
    if (elapsedInterval !== undefined) clearInterval(elapsedInterval)
    if (phraseInterval !== undefined) clearInterval(phraseInterval)
  })

  const sync = useSync()
  const params = useParams<{ id: string }>()
  const session = createMemo(() => sync().session.get(params.id ?? ""))

  const tokens = createMemo(() => {
    const t = session()?.tokens
    return t ? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0) : 0
  })

  const cost = createMemo(() => session()?.cost ?? 0)
  const hasTelemetry = createMemo(() => tokens() > 0 || cost() > 0)

  const formatTokens = (value: number) =>
    (compact() ? compactTokenFormatter : tokenFormatter).format(Math.round(value))
  const formatCost = (value: number) => costFormatter.format(value)

  return (
    <div
      class="streaming-status-bar"
      data-component="streaming-status-bar"
      style={{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        padding: "5px 16px",
        opacity: "1",
        "border-radius": "8px 8px 0 0",
        "min-height": "30px",
        overflow: "hidden",
        "margin-bottom": "-1px",
      }}
      role="status"
      aria-live="polite"
      aria-label={language.t("session.status.accessibleName")}
    >
      {/* Status phrase — shown on larger screens */}
      <div class="status-text-verbose" style={{ overflow: "hidden" }}>
        <span
          class={phraseFading() ? "status-phrase-exit" : "status-phrase-enter"}
          style={{
            display: "block",
            "font-size": "11.5px",
            "line-height": "1.4",
            color: "var(--v2-text-text-muted)",
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

      {/* Live activity travels from the phrase into realtime telemetry. */}
      <ModelActivityWaveform sessionID={params.id ?? ""} hasTelemetry={hasTelemetry()}>
        <Show when={hasTelemetry()}>
          <div class="streaming-status-telemetry">
            <Show when={tokens() > 0}>
              <span class="streaming-token-usage" aria-label={`${tokenFormatter.format(Math.round(tokens()))} tokens`}>
                <NumberTicker value={tokens()} format={formatTokens} />
                <span class="streaming-token-label"> tokens</span>
              </span>
            </Show>
            <Show when={cost() > 0}>
              <span class="streaming-cost" style={{ color: "var(--v2-state-fg-success)" }}>
                <NumberTicker value={cost()} format={formatCost} />
              </span>
            </Show>
          </div>
        </Show>
      </ModelActivityWaveform>

      {/* Elapsed timer */}
      <Show when={elapsedSeconds() > 0}>
        <span
          class="elapsed-timer"
          style={{
            "flex-shrink": "0",
            "font-size": "11px",
            color: "var(--v2-text-text-faint)",
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
