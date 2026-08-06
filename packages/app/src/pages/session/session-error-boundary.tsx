import { ErrorBoundary, lazy, type ParentProps } from "solid-js"
import type { ServerConnection } from "@/context/server"
import { useSettings } from "@/context/settings"
import { ErrorPage } from "@/pages/error"

import { isRecoverableDynamicImportError } from "@/utils/dynamic-import-recovery"

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
      fallback={(error, reset) => {
        if (isRecoverableDynamicImportError(error)) {
          return (
            <div class="flex flex-col items-center justify-center h-full p-8 text-center bg-[var(--ui-bg)]">
              <h2 class="text-xl font-medium mb-4 text-[var(--ui-fg)]">Application Update Available</h2>
              <p class="text-[var(--ui-fg-subtle)] mb-6 max-w-md">
                The application has been updated, but some required files could not be loaded. Please reload to apply the update.
              </p>
              <button
                class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                onClick={() => window.location.reload()}
              >
                Reload Application
              </button>
            </div>
          )
        }

        return settings.general.newLayoutDesigns() ? (
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
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}
