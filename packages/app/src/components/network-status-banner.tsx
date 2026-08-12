import { createSignal, onCleanup, Show, onMount } from "solid-js"

export function NetworkStatusBanner() {
  const [isOffline, setIsOffline] = createSignal(typeof navigator !== "undefined" ? !navigator.onLine : false)
  const [showOnlineBanner, setShowOnlineBanner] = createSignal(false)
  let onlineTimer: any

  const handleOnline = () => {
    setIsOffline(false)
    setShowOnlineBanner(true)
    if (onlineTimer) clearTimeout(onlineTimer)
    onlineTimer = setTimeout(() => {
      setShowOnlineBanner(false)
    }, 3000)
  }

  const handleOffline = () => {
    setIsOffline(true)
    setShowOnlineBanner(false)
    if (onlineTimer) clearTimeout(onlineTimer)
  }

  onMount(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline)
      window.addEventListener("offline", handleOffline)
    }
  })

  onCleanup(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
    if (onlineTimer) clearTimeout(onlineTimer)
  })

  return (
    <>
      <Show when={isOffline()}>
        <div
          role="alert"
          aria-live="assertive"
          class="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] bg-amber-600 dark:bg-amber-700 text-white text-center py-2 px-4 rounded-lg shadow-lg flex items-center justify-center gap-2 max-w-sm w-auto text-xs font-semibold animate-in fade-in slide-in-from-top duration-200"
        >
          <span class="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
          <span>You are offline. Working offline.</span>
        </div>
      </Show>
      <Show when={showOnlineBanner()}>
        <div
          role="status"
          aria-live="polite"
          class="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] bg-green-600 dark:bg-green-700 text-white text-center py-2 px-4 rounded-lg shadow-lg flex items-center justify-center gap-2 max-w-sm w-auto text-xs font-semibold animate-in fade-in slide-in-from-top duration-200"
        >
          <span class="inline-block w-2 h-2 rounded-full bg-white" />
          <span>Back online. Connection restored!</span>
        </div>
      </Show>
    </>
  )
}
