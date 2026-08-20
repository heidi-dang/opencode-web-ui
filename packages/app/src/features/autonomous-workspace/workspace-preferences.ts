export const WORKSPACE_PREFERENCE_VERSION = 1 as const

export const WORKSPACE_VIEWS = ["conversation", "lineage", "timeline", "changes", "context"] as const
export const WORKSPACE_PANELS = ["lineage", "timeline", "changes", "context", "terminal"] as const
export const WORKSPACE_CONTEXT_TABS = ["usage"] as const

export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number]
export type WorkspacePanel = (typeof WORKSPACE_PANELS)[number]
export type WorkspaceContextTab = (typeof WORKSPACE_CONTEXT_TABS)[number]

export type WorkspacePreferenceScope = {
  serverID: string
  directory: string
}

export type WorkspacePreference = {
  version: typeof WORKSPACE_PREFERENCE_VERSION
  enabled: boolean
  view: WorkspaceView
  expanded: WorkspacePanel[]
  contextTab?: WorkspaceContextTab
}

export const defaultWorkspacePreference: WorkspacePreference = {
  version: WORKSPACE_PREFERENCE_VERSION,
  enabled: false,
  view: "conversation",
  expanded: [],
}

const preferenceKeys = new Set(["version", "enabled", "view", "expanded", "contextTab"])
const panelSet = new Set<string>(WORKSPACE_PANELS)
const viewSet = new Set<string>(WORKSPACE_VIEWS)
const contextTabSet = new Set<string>(WORKSPACE_CONTEXT_TABS)

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isSafeScope(value: unknown): value is WorkspacePreferenceScope {
  const source = record(value)
  return !!source && isString(source.serverID) && source.serverID.length > 0 && isString(source.directory) && source.directory.length > 0
}

function copyDefault(): WorkspacePreference {
  return { ...defaultWorkspacePreference, expanded: [] }
}

function isKnownKeys(source: Record<string, unknown>) {
  return Object.keys(source).every((key) => preferenceKeys.has(key))
}

function parsePreference(value: unknown, allowUnknownKeys: boolean): WorkspacePreference | undefined {
  const source = record(value)
  if (!source || (!allowUnknownKeys && !isKnownKeys(source))) return undefined
  if (source.version !== WORKSPACE_PREFERENCE_VERSION || typeof source.enabled !== "boolean") return undefined
  if (!isString(source.view) || !viewSet.has(source.view)) return undefined
  if (!Array.isArray(source.expanded)) return undefined

  if (!source.expanded.every((panel) => isString(panel) && panelSet.has(panel))) return undefined
  const expanded = source.expanded as WorkspacePanel[]
  if (new Set(expanded).size !== expanded.length) return undefined

  const contextTab = source.contextTab
  if (contextTab !== undefined && (!isString(contextTab) || !contextTabSet.has(contextTab))) return undefined

  return contextTab === undefined
    ? { version: WORKSPACE_PREFERENCE_VERSION, enabled: source.enabled, view: source.view as WorkspaceView, expanded: [...expanded] }
    : {
        version: WORKSPACE_PREFERENCE_VERSION,
        enabled: source.enabled,
        view: source.view as WorkspaceView,
        expanded: [...expanded],
        contextTab: contextTab as WorkspaceContextTab,
      }
}

function storageOrDefault(storage?: Storage): Storage | undefined {
  if (storage) return storage
  if (typeof globalThis === "undefined") return undefined
  const candidate = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage
  return candidate
}

function scopePart(value: string) {
  return encodeURIComponent(value)
}

/**
 * Layout preferences are deliberately independent of session identity. A new
 * session in the same server/directory can reuse the user's layout, while
 * runtime truth remains owned by the active session controller.
 */
export function workspacePreferenceKey(scope: WorkspacePreferenceScope): string {
  if (!isSafeScope(scope)) throw new TypeError("Invalid autonomous workspace preference scope")
  return `opencode.autonomous-workspace.v${WORKSPACE_PREFERENCE_VERSION}:${scopePart(scope.serverID)}:${scopePart(scope.directory)}`
}

export function loadWorkspacePreference(scope: WorkspacePreferenceScope, storage?: Storage): WorkspacePreference {
  const target = storageOrDefault(storage)
  if (!target) return copyDefault()

  let raw: string | null
  try {
    raw = target.getItem(workspacePreferenceKey(scope))
  } catch {
    return copyDefault()
  }
  if (!raw) return copyDefault()

  try {
    return parsePreference(JSON.parse(raw), false) ?? copyDefault()
  } catch {
    return copyDefault()
  }
}

/**
 * Serializes only the known layout fields. The permissive input boundary is
 * intentional: runtime callers cannot accidentally persist session events,
 * credentials, or other non-preference data even if an object is cast at a
 * JavaScript boundary.
 */
export function saveWorkspacePreference(valueScope: WorkspacePreferenceScope, value: WorkspacePreference, storage?: Storage): boolean {
  const target = storageOrDefault(storage)
  if (!target) return false

  const normalized = parsePreference(value, true)
  if (!normalized) return false

  try {
    target.setItem(workspacePreferenceKey(valueScope), JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}
