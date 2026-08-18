import { AsyncLocalStorage } from "node:async_hooks"

export type RequestContext = {
  requestId: string
  backendId?: string
  sessionId?: string
  projectId?: string
  protocol?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function getRequestContext() {
  return storage.getStore()
}

export function runWithRequestContext<T>(context: RequestContext, operation: () => T): T {
  return storage.run(context, operation)
}

export function mergeRequestContext(fields: Partial<RequestContext>) {
  const current = storage.getStore()
  if (!current) return fields
  return { ...current, ...fields }
}
