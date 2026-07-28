export function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return "\u2014"
  if (ms < 1000) return `~${ms}ms`
  return `~${(ms / 1000).toFixed(1)}s`
}

export function formatRelativeTime(timestamp: number | undefined): string {
  if (!timestamp) return "\u2014"
  const diff = Date.now() - timestamp
  if (diff < 0) return "just now"
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return "just now"
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatVersion(version: string | undefined): string {
  if (!version) return "\u2014"
  return version.startsWith("v") ? version.slice(1) : version
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural ?? singular + "s"}`
}
