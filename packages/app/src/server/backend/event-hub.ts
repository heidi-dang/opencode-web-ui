import { isCriticalEvent, type BackendEvent } from "./events"
export type OverflowPolicy = "disconnect" | "coalesce-deltas"
export type SubscriberOptions = { maxPending?: number; overflow?: OverflowPolicy }
type Subscriber = { queue: BackendEvent[]; options: Required<SubscriberOptions>; listener: (event: BackendEvent) => void; dropped: number; disconnected: boolean }
export class EventHub {
  private readonly subscribers = new Set<Subscriber>()
  private readonly lastSequence = new Map<string, number>()
  publish(event: BackendEvent) { const key = `${event.backendId}:${event.sessionId || "global"}`; const previous = this.lastSequence.get(key) || 0; if (event.sequence <= previous) return false; this.lastSequence.set(key, event.sequence); for (const sub of [...this.subscribers]) { if (sub.disconnected) continue; if (sub.queue.length >= sub.options.maxPending) { if (sub.options.overflow === "coalesce-deltas" && event.type === "MESSAGE_DELTA" && sub.queue.at(-1)?.type === "MESSAGE_DELTA") sub.queue[sub.queue.length - 1] = event; else if (isCriticalEvent(event)) this.disconnect(sub); else { sub.dropped++; sub.queue.shift(); sub.queue.push(event) } } else sub.queue.push(event); this.flush(sub) } return true }
  subscribe(listener: (event: BackendEvent) => void, options: SubscriberOptions = {}) { const sub: Subscriber = { queue: [], options: { maxPending: 256, overflow: "disconnect", ...options }, listener, dropped: 0, disconnected: false }; this.subscribers.add(sub); return { unsubscribe: () => this.disconnect(sub), metrics: () => ({ pending: sub.queue.length, dropped: sub.dropped, disconnected: sub.disconnected }) } }
  private flush(sub: Subscriber) { while (sub.queue.length && !sub.disconnected) { const event = sub.queue.shift()!; try { sub.listener(event) } catch { this.disconnect(sub) } } }
  private disconnect(sub: Subscriber) { sub.disconnected = true; sub.queue.length = 0; this.subscribers.delete(sub) }
  metrics() { return { subscribers: this.subscribers.size, sequences: this.lastSequence.size } }
}
