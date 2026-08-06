export type StreamPacerClock = {
  frame: (callback: () => void) => number
  cancelFrame: (id: number) => void
  timeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void
}

const browserClock: StreamPacerClock = {
  frame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  timeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id),
}

export function createStreamPacer(input: {
  read: () => string
  write: (value: string) => void
  clock?: StreamPacerClock
  fallbackMs?: number
}) {
  const clock = input.clock ?? browserClock
  let frame: number | undefined
  let fallback: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    if (frame !== undefined) clock.cancelFrame(frame)
    if (fallback !== undefined) clock.clearTimeout(fallback)
    frame = undefined
    fallback = undefined
  }

  const flush = () => {
    cancel()
    input.write(input.read())
  }

  const schedule = () => {
    if (frame !== undefined || fallback !== undefined) return
    frame = clock.frame(flush)
    fallback = clock.timeout(flush, input.fallbackMs ?? 48)
  }

  return { cancel, flush, schedule }
}
