export type BackendType = "opencode" | (string & {})

export type BackendCapabilities = {
  projects: boolean
  sessions: boolean
  files: boolean
  terminal: boolean
  tools: boolean
  permissions: boolean
  subagents: boolean
  plugins: boolean
  dynamicPlugins: boolean
  backgroundTasks: boolean
}

export type BackendDescriptor = {
  id: string
  type: BackendType
  name: string
  endpoint: string
  enabled: boolean
  state: "REGISTERED" | "READY" | "UNHEALTHY" | "AUTH_FAILED"
  protocol?: string
  capabilities: BackendCapabilities
  createdAt: string
  updatedAt: string
  lastSeenAt?: string
}

export type BackendHealth = {
  backendId: string
  reachable: boolean
  authenticated: boolean
  healthy: boolean
  latencyMs: number
  error?: string
  checkedAt: string
}

export type BackendProject = { id: string; name?: string; directory?: string; extensions?: Record<string, unknown> }
export type BackendSession = { id: string; projectId?: string; title?: string; status?: string; extensions?: Record<string, unknown> }
export type BackendProvider = { id: string; name?: string; models?: BackendModel[]; extensions?: Record<string, unknown> }
export type BackendModel = { id: string; name?: string; providerId?: string; extensions?: Record<string, unknown> }

export type BackendError = { code: string; message: string; retryable: boolean; cause?: unknown }

export const defaultBackendCapabilities = (): BackendCapabilities => ({
  projects: false, sessions: false, files: false, terminal: false, tools: false,
  permissions: false, subagents: false, plugins: false, dynamicPlugins: false, backgroundTasks: false,
})

export function backendIdentityEqual(a: Pick<BackendDescriptor, "id" | "type">, b: Pick<BackendDescriptor, "id" | "type">) {
  return a.id === b.id && a.type === b.type
}

export function assertImmutableBackendIdentity(existing: Pick<BackendDescriptor, "id" | "type">, update: Partial<Pick<BackendDescriptor, "id" | "type">>) {
  if (update.id !== undefined && update.id !== existing.id) throw new Error("BACKEND_ID_IMMUTABLE")
  if (update.type !== undefined && update.type !== existing.type) throw new Error("BACKEND_TYPE_IMMUTABLE")
}

export type Workspace = {
  id: string
  backendId: string
  projectId?: string
  agent?: string
  providerId?: string
  modelId?: string
  activeSessionId?: string
}

export function validateWorkspace(workspace: Workspace) {
  if (!workspace.id || !workspace.backendId) throw new Error("INVALID_WORKSPACE")
  if (workspace.activeSessionId && !workspace.projectId) throw new Error("WORKSPACE_SESSION_REQUIRES_PROJECT")
  return workspace
}
