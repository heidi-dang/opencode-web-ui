export function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return "\u2014"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
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
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

export function formatVersion(version: string | undefined): string {
  if (!version) return "\u2014"
  return version.startsWith("v") ? version.slice(1) : version
}
