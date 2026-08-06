import { lazy, type Component } from "solid-js"

/**
 * Helpers to recover from stale-chunk dynamic import failures (e.g. ChunkLoadError)
 * by safely reloading the application context without triggering reload loops.
 */

/**
 * Checks if the given error matches known browser error messages for missing module chunks.
 *
 * @param error The exception thrown during a dynamic import.
 */
export function isRecoverableDynamicImportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  // Do not attempt recovery if the browser is offline
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false
  }

  const msg = error.message.toLowerCase()

  // Common browser chunk loading error patterns
  const patterns = [
    "failed to fetch dynamically imported module", // Chrome / Edge
    "importing a module script failed",            // Safari
    "error loading dynamically imported module",   // Firefox
    "chunkloaderror",                              // Webpack/Vite chunk error class
    "loading chunk",                               // Generic loading chunk error
    "css chunk load failed",                       // CSS chunks
  ]

  return patterns.some((pattern) => msg.includes(pattern))
}

const getStorage = () => {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null
  } catch {
    return null // Blocked or unavailable
  }
}

export function createRecoverableDynamicImport<T>(
  fn: () => Promise<T>,
  buildId: string,
  reloadFn: () => void = () => { if (typeof window !== "undefined") window.location.reload() }
): () => Promise<T> {
  return () =>
    fn()
      .then((mod) => {
        const storage = getStorage()
        if (storage) {
          try {
            storage.removeItem(`oc_dyn_import_retry:${buildId}`)
          } catch {}
        }
        return mod
      })
      .catch((err) => {
        if (isRecoverableDynamicImportError(err)) {
          const storage = getStorage()
          if (storage) {
            try {
              const key = `oc_dyn_import_retry:${buildId}`
              if (!storage.getItem(key)) {
                storage.setItem(key, "1")
                reloadFn()
                // Return a pending promise so the UI doesn't render until reload completes.
                return new Promise<T>(() => {}).catch(() => { throw err }) as Promise<T>
              }
            } catch {
              // Ignore storage errors and fallback to throwing
            }
          }
        }
        throw err
      })
}

export function safeLazy<T extends { default: Component<any> }>(
  fn: () => Promise<T>,
  buildId: string
): Component<any> {
  return lazy(createRecoverableDynamicImport(fn, buildId))
}
