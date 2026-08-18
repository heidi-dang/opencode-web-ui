import type { BackendDescriptor, BackendHealth, BackendModel, BackendProject, BackendProvider, BackendSession } from "./domain"
import type { BackendEvent } from "./events"

export type PromptInput = { sessionId: string; text: string; directory?: string; modelId?: string; providerId?: string }
export type BackendEventSubscription = { unsubscribe(): void }

export interface AgentBackend {
  readonly descriptor: BackendDescriptor
  connect(signal?: AbortSignal): Promise<void>
  disconnect(): Promise<void>
  health(signal?: AbortSignal): Promise<BackendHealth>
  capabilities(signal?: AbortSignal): Promise<BackendDescriptor["capabilities"]>
  listProjects(signal?: AbortSignal): Promise<BackendProject[]>
  listSessions(projectId?: string, signal?: AbortSignal): Promise<BackendSession[]>
  getSession(sessionId: string, signal?: AbortSignal): Promise<BackendSession | undefined>
  createSession(projectId?: string, signal?: AbortSignal): Promise<BackendSession>
  interruptSession(sessionId: string, signal?: AbortSignal): Promise<void>
  prompt(input: PromptInput, signal?: AbortSignal): Promise<void>
  listProviders(signal?: AbortSignal): Promise<BackendProvider[]>
  listModels(signal?: AbortSignal): Promise<BackendModel[]>
  subscribe(listener: (event: BackendEvent) => void): BackendEventSubscription
}
