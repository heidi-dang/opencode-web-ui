import { ErrorBoundary, lazy, type ParentProps } from "solid-js"
import type { ServerConnection } from "@/context/server"
import { useSettings } from "@/context/settings"
import { ErrorPage } from "@/pages/error"

// Lazy-load the heavy fallback UI (avoids pulling session.tsx into entry chunk)
const SessionErrorFallback = lazy(() =>
  import("@/pages/session/session-error-fallback").then((m) => ({ default: m.SessionErrorFallback })),
)

export function SessionRouteErrorBoundary(
  props: ParentProps<{ sessionID?: string; serverKey?: ServerConnection.Key; padded?: boolean }>,
) {
  const settings = useSettings()
  return (
    <ErrorBoundary
      fallback={(error, reset) =>
        settings.general.newLayoutDesigns() ? (
          <SessionErrorFallback
            error={error}
            sessionID={props.sessionID}
            serverKey={props.serverKey}
            padded={props.padded}
            onRetry={reset}
          />
        ) : (
          <ErrorPage error={error} />
        )
      }
    >
      {props.children}
    </ErrorBoundary>
  )
}
