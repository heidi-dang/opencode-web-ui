const BUILTIN_AGENTS = new Set(["build", "plan"])

export function hasCustomAgent(items: Array<{ name?: string; native?: boolean; mode?: string }>) {
  if (items.length === 0) return false
  return items.some((item) => {
    if (item.native === false) return true
    if (item.native === true) return false
    if (item.name && !BUILTIN_AGENTS.has(item.name)) return true
    return false
  })
}

export function resolveAgent<T extends { name: string }>(items: T[], name?: string, defaultAgent?: string) {
  if (items.length === 0) return undefined
  // 1. Explicitly requested valid agent
  if (name) {
    const match = items.find((item) => item.name === name)
    if (match) return match
  }
  // 2. Backend-defined default_agent
  if (defaultAgent) {
    const defaultMatch = items.find((item) => item.name === defaultAgent)
    if (defaultMatch) return defaultMatch
  }
  // 3. Fall back to build if available
  const buildMatch = items.find((item) => item.name === "build")
  if (buildMatch) return buildMatch
  // 4. Fall back to first available agent
  return items[0]
}
