export type SessionSelectionQueue<T> = {
  set(value: T): Promise<boolean>
  wait(): Promise<boolean>
  pending(): boolean
}

type PendingSelection<T> = {
  revision: number
  value: T
  resolve: (success: boolean) => void
}

/**
 * Serialize session-level selection mutations while keeping only the latest
 * pending intent. A selection is committed only after its server mutation
 * succeeds and is still the latest requested value.
 */
export function createSessionSelectionQueue<T>(input: {
  apply(value: T): Promise<void>
  commit(value: T): void
  onError?(error: unknown): void
}): SessionSelectionQueue<T> {
  let revision = 0
  let latest: PendingSelection<T> | undefined
  let running = false
  let settled = Promise.resolve()
  let lastResult = true

  async function drain() {
    while (latest) {
      const current = latest
      latest = undefined

      try {
        await input.apply(current.value)
        input.commit(current.value)
        const isLatest = current.revision === revision
        if (isLatest) lastResult = true
        current.resolve(isLatest)
      } catch (error) {
        const isLatest = current.revision === revision
        if (isLatest) {
          lastResult = false
          input.onError?.(error)
        }
        current.resolve(false)
      }
    }

    running = false
  }

  return {
    set(value) {
      const currentRevision = ++revision
      const previous = latest
      previous?.resolve(false)

      const result = new Promise<boolean>((resolve) => {
        latest = { revision: currentRevision, value, resolve }
      })

      if (!running) {
        running = true
        settled = drain()
      }

      return result
    },
    async wait() {
      if (!running) return lastResult
      await settled
      return lastResult
    },
    pending() {
      return running
    },
  }
}
