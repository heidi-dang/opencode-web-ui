type Entry<T> = { value: T; expiresAt: number; staleUntil: number }
export type CacheOptions = { maxEntries?: number; ttlMs?: number; staleMs?: number }
export class BoundedCache<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly options: Required<CacheOptions>
  constructor(options: CacheOptions = {}) { this.options = { maxEntries: 256, ttlMs: 30_000, staleMs: 60_000, ...options } }
  get(key: string) { const entry = this.entries.get(key); if (!entry) return; if (entry.staleUntil < Date.now()) { this.entries.delete(key); return } this.entries.delete(key); this.entries.set(key, entry); return { value: entry.value, stale: entry.expiresAt < Date.now() } }
  set(key: string, value: T) { this.entries.delete(key); this.entries.set(key, { value, expiresAt: Date.now() + this.options.ttlMs, staleUntil: Date.now() + this.options.ttlMs + this.options.staleMs }); while (this.entries.size > this.options.maxEntries) this.entries.delete(this.entries.keys().next().value!) }
  invalidate(key?: string) { if (key) this.entries.delete(key); else this.entries.clear() }
  get size() { return this.entries.size }
}
