import { isCriticalEvent, type BackendEvent } from "./events"
import { runtimeLogger } from "../observability/logger"

export type OverflowPolicy = "disconnect" | "coalesce-deltas"
export type SubscriberOptions = { maxPending?: number; overflow?: OverflowPolicy }
type Subscriber = { queue: BackendEvent[]; options: Required<SubscriberOptions>; listener: (event: BackendEvent) => void; dropped: number; disconnected: boolean; draining: boolean; delivered: number }

export class EventHub {
  private readonly subscribers = new Set<Subscriber>()
  private readonly lastSequence = new Map<string, number>()

  publish(event: BackendEvent) {
    const key = `${event.backendId}:${event.sessionId || "global"}`
    const previous = this.lastSequence.get(key) || 0
    if (event.sequence <= previous) { runtimeLogger.trace("eventhub.duplicate", { backendId: event.backendId, sessionId: event.sessionId, eventType: event.type, sequence: event.sequence }); return false }
    this.lastSequence.set(key, event.sequence)
    runtimeLogger.trace("eventhub.event", { backendId: event.backendId, sessionId: event.sessionId, eventType: event.type, sequence: event.sequence })
    for (const sub of [...this.subscribers]) {
      if (sub.disconnected) continue
      if (sub.queue.length >= sub.options.maxPending) {
        if (sub.options.overflow === "coalesce-deltas" && event.type === "MESSAGE_DELTA" && sub.queue.at(-1)?.type === "MESSAGE_DELTA") sub.queue[sub.queue.length - 1] = event
        else if (isCriticalEvent(event)) {
          const evictIndex = sub.queue.findIndex((queued) => !isCriticalEvent(queued))
          if (evictIndex >= 0) { sub.dropped++; sub.queue.splice(evictIndex, 1); sub.queue.push(event) }
          else this.disconnect(sub, "critical-event-overflow")
        } else { sub.dropped++; sub.queue.shift(); sub.queue.push(event) }
        runtimeLogger.warn("eventhub.overflow", { backendId: event.backendId, sessionId: event.sessionId, eventType: event.type, dropped: sub.dropped, policy: sub.options.overflow })
      } else sub.queue.push(event)
      this.scheduleDrain(sub)
    }
    return true
  }

  subscribe(listener: (event: BackendEvent) => void, options: SubscriberOptions = {}) {
    const sub: Subscriber = { queue: [], options: { maxPending: 256, overflow: "disconnect", ...options }, listener, dropped: 0, disconnected: false, draining: false, delivered: 0 }
    this.subscribers.add(sub)
    runtimeLogger.debug("eventhub.subscribe", { subscribers: this.subscribers.size, maxPending: sub.options.maxPending, overflow: sub.options.overflow })
    return { unsubscribe: () => this.disconnect(sub, "unsubscribed"), metrics: () => ({ pending: sub.queue.length, dropped: sub.dropped, delivered: sub.delivered, disconnected: sub.disconnected }) }
  }

  private scheduleDrain(sub: Subscriber) {
    if (sub.draining || sub.disconnected) return
    sub.draining = true
    queueMicrotask(() => {
      sub.draining = false
      if (sub.disconnected) return
      const event = sub.queue.shift()
      if (!event) return
      try { sub.listener(event); sub.delivered++ } catch (error) { runtimeLogger.error("eventhub.event_error", { backendId: event.backendId, sessionId: event.sessionId, eventType: event.type, sequence: event.sequence, error }); this.disconnect(sub, "listener-error"); return }
      if (sub.queue.length) this.scheduleDrain(sub)
    })
  }

  private disconnect(sub: Subscriber, reason: string) { sub.disconnected = true; sub.queue.length = 0; this.subscribers.delete(sub); runtimeLogger.debug("eventhub.unsubscribe", { reason, subscribers: this.subscribers.size, dropped: sub.dropped, delivered: sub.delivered }) }
  clearBackend(backendId: string) { for (const key of this.lastSequence.keys()) if (key.startsWith(`${backendId}:`)) this.lastSequence.delete(key) }
  metrics() { return { subscribers: this.subscribers.size, sequences: this.lastSequence.size } }
}
