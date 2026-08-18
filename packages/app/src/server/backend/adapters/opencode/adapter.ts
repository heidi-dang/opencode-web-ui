import { getServer, probeRegisteredServer, type RegisteredServer } from "../../../server-registry"
import { assertNetworkPolicy } from "../../network"
import { EventHub } from "../../event-hub"
import { defaultBackendCapabilities, type BackendDescriptor, type BackendHealth, type BackendModel, type BackendProject, type BackendProvider, type BackendSession } from "../../domain"
import type { AgentBackend, BackendEventSubscription, PromptInput } from "../../agent-backend"
import type { BackendEvent } from "../../events"

export class OpenCodeAdapter implements AgentBackend {
  readonly descriptor: BackendDescriptor
  private readonly events = new EventHub()
  private eventAbort?: AbortController
  private eventTask?: Promise<void>
  private sequence = 0
  constructor(private readonly server: RegisteredServer) {
    this.descriptor = { id: server.id, type: "opencode", name: server.name, endpoint: server.baseUrl, enabled: server.enabled, state: server.state, protocol: server.protocol, capabilities: { ...defaultBackendCapabilities(), projects: true, sessions: true, tools: true, permissions: true }, createdAt: server.updatedAt, updatedAt: server.updatedAt }
  }
  async connect() {
    if (!this.server.enabled) throw new Error("SERVER_DISABLED")
    if (this.eventTask) return
    this.eventAbort = new AbortController()
    this.eventTask = this.consumeEvents(this.eventAbort.signal).catch((error) => {
      if (!this.eventAbort?.signal.aborted) this.events.publish({ id: `${this.server.id}:event-error:${++this.sequence}`, sequence: this.sequence, backendId: this.server.id, backendType: "opencode", type: "ERROR", timestamp: new Date().toISOString(), payload: { error: error instanceof Error ? error.message : "EVENT_STREAM_FAILED" } })
    }).finally(() => { this.eventTask = undefined })
  }
  async disconnect() {
    this.eventAbort?.abort()
    await this.eventTask?.catch(() => undefined)
    this.eventAbort = undefined
  }

  private async consumeEvents(signal: AbortSignal) {
    const response = await this.request<Response>("event", { signal, raw: true })
    if (!response.body) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (!signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() || ""
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n")
          if (!data) continue
          try { this.publishUpstreamEvent(JSON.parse(data)) } catch { /* ignore malformed SSE frames */ }
        }
      }
    } finally { await reader.cancel().catch(() => undefined) }
  }

  private publishUpstreamEvent(value: unknown) {
    const raw = value && typeof value === "object" ? value as Record<string, unknown> : {}
    const type = String(raw.type || raw.event || "")
    const mapping: Record<string, BackendEvent["type"]> = { "session.created": "SESSION_CREATED", "session.updated": "SESSION_STARTED", "session.idle": "SESSION_IDLE", "session.error": "SESSION_ERROR", "message.updated": "MESSAGE_DELTA", "message.completed": "MESSAGE_END", "tool.started": "TOOL_START", "tool.updated": "TOOL_UPDATE", "tool.completed": "TOOL_END", "permission.asked": "PERMISSION_REQUEST" }
    const eventType = mapping[type] || (type === "error" ? "ERROR" : undefined)
    if (!eventType) return
    const properties = raw.properties && typeof raw.properties === "object" ? raw.properties as Record<string, unknown> : {}
    const sessionId = typeof raw.sessionID === "string" ? raw.sessionID : typeof properties.sessionID === "string" ? properties.sessionID : undefined
    this.events.publish({ id: `${this.server.id}:${++this.sequence}`, sequence: this.sequence, backendId: this.server.id, backendType: "opencode", sessionId, type: eventType, timestamp: new Date().toISOString(), payload: value })
  }
  async health(signal?: AbortSignal): Promise<BackendHealth> { if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError"); const result = await probeRegisteredServer(this.server, 5000, signal); return { backendId: this.server.id, reachable: result.reachable, authenticated: result.authenticated, healthy: result.healthy, latencyMs: result.latencyMs, error: result.error, checkedAt: new Date().toISOString() } }
  async capabilities() { return this.descriptor.capabilities }
  private async request<T>(path: string, init?: RequestInit & { raw?: boolean }): Promise<T> { const url = assertNetworkPolicy(new URL(path, `${this.server.baseUrl}/`).toString()); const headers = new Headers(init?.headers); headers.delete("authorization"); if (this.server.password) headers.set("authorization", `Basic ${Buffer.from(`${this.server.username || "opencode"}:${this.server.password}`).toString("base64")}`); const { raw, ...requestInit } = init || {}; const response = await fetch(url, { ...requestInit, headers, redirect: "manual" }); if (response.status >= 300 && response.status < 400) throw new Error("BACKEND_REDIRECT_NOT_ALLOWED"); if (!response.ok) throw new Error(`BACKEND_HTTP_${response.status}`); return (raw ? response : response.json()) as T }
  async listProjects(signal?: AbortSignal) { const value = await this.request<unknown>(this.server.protocol === "v2" ? "project" : "api/project", { signal }); const projects = Array.isArray(value) ? value : (value as { projects?: unknown[] })?.projects; return (projects || []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => ({ id: String(item.id || item.directory || item.name), name: typeof item.name === "string" ? item.name : undefined, directory: typeof item.directory === "string" ? item.directory : undefined })) as BackendProject[] }
  async listSessions(projectId?: string, signal?: AbortSignal) { const value = await this.request<unknown>(`session${projectId ? `?directory=${encodeURIComponent(projectId)}` : ""}`, { signal }); return (Array.isArray(value) ? value : []) as BackendSession[] }
  async getSession(sessionId: string, signal?: AbortSignal) { return this.request<BackendSession>(`session/${encodeURIComponent(sessionId)}`, { signal }) }
  async createSession(projectId?: string, signal?: AbortSignal) { return this.request<BackendSession>("session", { method: "POST", body: JSON.stringify(projectId ? { directory: projectId } : {}), signal }) }
  async interruptSession(sessionId: string, signal?: AbortSignal) { await this.request(`session/${encodeURIComponent(sessionId)}/interrupt`, { method: "POST", signal }) }
  async prompt(input: PromptInput, signal?: AbortSignal) { await this.request(`session/${encodeURIComponent(input.sessionId)}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parts: [{ type: "text", text: input.text }] }), signal }) }
  async listProviders(signal?: AbortSignal) { const value = await this.request<{ providers?: BackendProvider[] }>("provider", { signal }); return value.providers || [] }
  async listModels(signal?: AbortSignal) { const providers = await this.listProviders(signal); return providers.flatMap((provider) => (provider.models || []).map((model) => ({ ...model, providerId: model.providerId || provider.id }))) as BackendModel[] }
  subscribe(listener: (event: BackendEvent) => void): BackendEventSubscription { return this.events.subscribe(listener) }
}

export async function openCodeAdapter(id: string) { const server = await getServer(id); if (!server) throw new Error("SERVER_NOT_FOUND"); return new OpenCodeAdapter(server) }
