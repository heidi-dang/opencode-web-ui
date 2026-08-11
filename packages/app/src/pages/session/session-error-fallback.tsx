import { createMemo, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { ServerConnection, serverName, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { ErrorPage } from "@/pages/error"
import { isCurrentSessionNotFoundError } from "@/utils/server-errors"
import { copyToClipboard } from "@opencode-ai/ui/utils/clipboard"

export function SessionErrorFallback(props: {
  error: unknown
  sessionID?: string
  serverKey?: ServerConnection.Key
  padded?: boolean
  onRetry?: () => void
}) {
  const language = useLanguage()
  const server = useServer()
  const tabs = useTabs()
  const displayServer = createMemo(() => {
    const key = props.serverKey ?? server.key
    const conn = server.list.find((item) => ServerConnection.key(item) === key)
    return conn ? serverName(conn) : key
  })
  const closeTab = () => {
    if (!props.sessionID) return
    tabs.removeSessionTab({ server: props.serverKey ?? server.key, sessionId: props.sessionID })
  }

  if (isCurrentSessionNotFoundError(props.error, props.sessionID)) {
    return (
      // Inline SessionRouteFrame + SessionPanelFrame styles to avoid importing session.tsx
      <div class="relative size-full overflow-hidden flex flex-col" classList={{ "p-2": props.padded }}>
        <div
          classList={{
            "flex-1 min-h-0 flex flex-col": true,
            "bg-v2-background-bg-base": true,
            "rounded-[10px] overflow-hidden": true,
            "shadow-[var(--v2-elevation-raised)]": !!props.sessionID,
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
              <div class="flex flex-col items-center gap-2">
                <div class="text-16-medium text-text max-w-md">{language.t("session.error.notFound")}</div>
                <div class="text-13-regular text-text-weak max-w-md">
                  {language.t("session.error.notFound.description")}
                </div>
              </div>
              <Show when={props.sessionID}>
                {(sessionID) => (
                  <div class="max-w-full flex flex-col items-center gap-1">
                    <div class="max-w-full text-11-regular text-text-faint break-all">{displayServer()}</div>
                    <code class="max-w-full rounded-[4px] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-text-base break-all bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)]">
                      {sessionID()}
                    </code>
                  </div>
                )}
              </Show>
              <ButtonV2 variant="neutral" size="normal" icon="xmark-small" onClick={closeTab}>
                {language.t("session.error.notFound.closeTab")}
              </ButtonV2>
            </div>
          </div>
        </div>
      </div>
    )
  }
  // Transient errors: show retry button alongside error details.
  // This lets the ErrorBoundary reset and re-render the session content.
  // When onRetry is not available, fall back to the full-page error screen.
  if (props.onRetry) {
    return (
      <div class="relative size-full overflow-hidden flex flex-col" classList={{ "p-2": props.padded }}>
        <div
          classList={{
            "flex-1 min-h-0 flex flex-col": true,
            "bg-v2-background-bg-base": true,
            "rounded-[10px] overflow-hidden": true,
            "shadow-[var(--v2-elevation-raised)]": !!props.sessionID,
          }}
        >
          <div class="flex-1 min-h-0 overflow-hidden">
            <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
              <div class="flex flex-col items-center gap-2">
                <div class="text-16-medium text-text max-w-md">{language.t("notification.session.error.title")}</div>
                <div class="text-13-regular text-text-weak max-w-md">
                  {language.t("notification.session.error.fallbackDescription")}
                </div>
              </div>
              <div class="flex items-center gap-2">
                <ButtonV2 variant="outline" size="normal" icon="arrow-clockwise" onClick={props.onRetry}>
                  {language.t("wsl.server.retryStart")}
                </ButtonV2>
                <ButtonV2
                  variant="outline"
                  size="normal"
                  icon="copy"
                  onClick={() => {
                    const msg =
                      props.error instanceof Error
                        ? props.error.stack || props.error.message
                        : String(props.error)
                    const diagnostics = `Error: ${msg}\nSession ID: ${props.sessionID ?? "none"}\nServer Key: ${props.serverKey ?? "none"}`
                    copyToClipboard(diagnostics)
                  }}
                >
                  Copy Diagnostics
                </ButtonV2>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  return <ErrorPage error={props.error} />
}
