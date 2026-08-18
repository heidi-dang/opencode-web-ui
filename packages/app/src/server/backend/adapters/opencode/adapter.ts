import { getServer, probeRegisteredServer, type RegisteredServer } from "../../../server-registry"
import { EventHub } from "../../event-hub"
import { defaultBackendCapabilities, type BackendDescriptor, type BackendHealth, type BackendModel, type BackendProject, type BackendProvider, type BackendSession } from "../../domain"
import type { AgentBackend, BackendEventSubscription, PromptInput } from "../../agent-backend"
import type { BackendEvent } from "../../events"

export class OpenCodeAdapter implements AgentBackend {
  readonly descriptor: BackendDescriptor
  private readonly events = new EventHub()
  constructor(private readonly server: RegisteredServer) {
    this.descriptor = { id: server.id, type: "opencode", name: server.name, endpoint: server.baseUrl, enabled: server.enabled, state: server.state, protocol: server.protocol, capabilities: { ...defaultBackendCapabilities(), projects: true, sessions: true, tools: true, permissions: true }, createdAt: server.updatedAt, updatedAt: server.updatedAt }
  }
  async connect() { if (!this.server.enabled) throw new Error("SERVER_DISABLED") }
  async disconnect() {}
  async health(signal?: AbortSignal): Promise<BackendHealth> { const result = await probeRegisteredServer(this.server, 5000); return { backendId: this.server.id, reachable: result.reachable, authenticated: result.authenticated, healthy: result.healthy, latencyMs: result.latencyMs, error: result.error, checkedAt: new Date().toISOString() } }
  async capabilities() { return this.descriptor.capabilities }
  private async request<T>(path: string, init?: RequestInit): Promise<T> { const url = new URL(path, `${this.server.baseUrl}/`); const headers = new Headers(init?.headers); headers.delete("authorization"); if (this.server.password) headers.set("authorization", `Basic ${Buffer.from(`${this.server.username || "opencode"}:${this.server.password}`).toString("base64")}`); const response = await fetch(url, { ...init, headers }); if (!response.ok) throw new Error(`BACKEND_HTTP_${response.status}`); return response.json() as Promise<T> }
  async listProjects() { const value = await this.request<unknown>(this.server.protocol === "v2" ? "project" : "api/project"); const projects = Array.isArray(value) ? value : (value as { projects?: unknown[] })?.projects; return (projects || []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => ({ id: String(item.id || item.directory || item.name), name: typeof item.name === "string" ? item.name : undefined, directory: typeof item.directory === "string" ? item.directory : undefined })) as BackendProject[] }
  async listSessions(projectId?: string) { const value = await this.request<unknown>(`session${projectId ? `?directory=${encodeURIComponent(projectId)}` : ""}`); return (Array.isArray(value) ? value : []) as BackendSession[] }
  async getSession(sessionId: string) { return this.request<BackendSession>(`session/${encodeURIComponent(sessionId)}`) }
  async createSession(projectId?: string) { return this.request<BackendSession>("session", { method: "POST", body: JSON.stringify(projectId ? { directory: projectId } : {}) }) }
  async interruptSession(sessionId: string) { await this.request(`session/${encodeURIComponent(sessionId)}/interrupt`, { method: "POST" }) }
  async prompt(input: PromptInput) { await this.request(`session/${encodeURIComponent(input.sessionId)}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parts: [{ type: "text", text: input.text }] }) }) }
  async listProviders() { const value = await this.request<{ providers?: BackendProvider[] }>("provider"); return value.providers || [] }
  async listModels() { const providers = await this.listProviders(); return providers.flatMap((provider) => (provider.models || []).map((model) => ({ ...model, providerId: model.providerId || provider.id }))) as BackendModel[] }
  subscribe(listener: (event: BackendEvent) => void): BackendEventSubscription { return this.events.subscribe(listener) }
}

export async function openCodeAdapter(id: string) { const server = await getServer(id); if (!server) throw new Error("SERVER_NOT_FOUND"); return new OpenCodeAdapter(server) }
