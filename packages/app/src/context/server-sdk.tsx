import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import type { Event } from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { makeEventListener } from "@solid-primitives/event-listener"
import { type Accessor, batch, createMemo, createResource, onCleanup, onMount } from "solid-js"
import { createApiForServer, createSdkForServer, type ServerApi } from "@/utils/server"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { ServerConnection, useServer } from "./server"
import { createRefCountMap } from "@/utils/refcount"
import { useGlobal } from "./global"
import { ServerScope } from "@/utils/server-scope"
import { detectServerProtocol, type ServerProtocol } from "@/utils/server-protocol"
import { createConnectionManager } from "@/utils/connection-manager"
import { createCompatibleApi, type CompatibleApi } from "@/utils/server-compat"
import { clientDiagnostics } from "@/utils/client-diagnostics"

const isAbortError = (error: unknown) =>
  error !== null && typeof error === "object" && "name" in error && error.name === "AbortError"

const isStreamClosed = (error: unknown, signal?: AbortSignal) => isAbortError(error) || signal?.aborted === true

// The current event endpoint is volatile: reconnecting from an event id can
// replay an incomplete execution and duplicate already reconciled messages.
// Recovery is intentionally authoritative (status/messages/interaction state),
// so keep the generated SSE client from asking the server for event replay.
function withoutEventReplay(fetcher: typeof globalThis.fetch) {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    headers.delete("last-event-id")
    return fetcher(request, { ...init, headers })
  }) as typeof globalThis.fetch
}
export type ServerEvent = Event & { current?: unknown }
type QueuedServerEvent = { directory: string; payload: ServerEvent }
type CurrentDelta = Extract<
  OpenCodeEvent,
  { type: "session.text.delta" | "session.reasoning.delta" | "session.tool.input.delta" | "session.compaction.delta" }
>

export function adaptServerEvent(input: unknown): ServerEvent {
  const event = input as unknown as {
    id: string
    type: string
    data: Record<string, unknown>
  }
  if (event.type === "permission.v2.asked") {
    const source = event.data.source && typeof event.data.source === "object" ? (event.data.source as Record<string, unknown>) : undefined
    return {
      id: event.id,
      type: "permission.asked",
      properties: {
        id: event.data.id,
        sessionID: event.data.sessionID,
        permission: event.data.action,
        patterns: event.data.resources,
        always: event.data.save ?? [],
        metadata: event.data.metadata ?? {},
        tool:
          source?.type === "tool"
            ? { messageID: source.messageID, callID: source.callID }
            : undefined,
      },
      current: input,
    } as ServerEvent
  }
  if (event.type === "permission.v2.replied")
    return { id: event.id, type: "permission.replied", properties: event.data, current: input } as ServerEvent
  if (event.type === "question.v2.asked")
    return { id: event.id, type: "question.asked", properties: event.data, current: input } as ServerEvent
  if (event.type === "question.v2.replied")
    return { id: event.id, type: "question.replied", properties: event.data, current: input } as ServerEvent
  if (event.type === "question.v2.rejected")
    return { id: event.id, type: "question.rejected", properties: event.data, current: input } as ServerEvent
  return { id: event.id, type: event.type, properties: event.data, current: input } as ServerEvent
}

const coalescedKey = (event: QueuedServerEvent) => {
  if (event.payload.type === "lsp.updated") return `lsp.updated:${event.directory}`
  if (event.payload.type === "message.part.updated") {
    const properties = event.payload.properties as unknown
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined
    const part = (properties as { part?: unknown }).part
    if (!part || typeof part !== "object" || Array.isArray(part)) return undefined
    const messageID = (part as { messageID?: unknown }).messageID
    const partID = (part as { id?: unknown }).id
    if (typeof messageID !== "string" || typeof partID !== "string") return undefined
    return `message.part.updated:${event.directory}:${messageID}:${partID}`
  }
  return undefined
}

export function enqueueServerEvent(queue: QueuedServerEvent[], event: QueuedServerEvent) {
  const key = coalescedKey(event)
  const previous = queue[queue.length - 1]
  if (key && previous && coalescedKey(previous) === key) {
    queue[queue.length - 1] = event
    return false
  }
  queue.push(event)
  return true
}

export function coalesceServerEvents(events: QueuedServerEvent[]) {
  const output: QueuedServerEvent[] = []
  events.forEach((event) => {
    const current = currentDelta(event.payload.current)
    if (current) {
      const previous = output[output.length - 1]
      const prior = currentDelta(previous?.payload.current)
      if (
        previous &&
        prior &&
        previous.directory === event.directory &&
        currentDeltaKey(prior) === currentDeltaKey(current)
      ) {
        const fragment = currentDeltaFragment(prior) + currentDeltaFragment(current)
        const data =
          current.type === "session.compaction.delta"
            ? { ...current.data, text: fragment }
            : { ...current.data, delta: fragment }
        output[output.length - 1] = {
          directory: event.directory,
          payload: {
            ...event.payload,
            properties: data,
            current: { ...current, data } as CurrentDelta,
          } as ServerEvent,
        }
        return
      }
      output.push(event)
      return
    }
    if (event.payload.type !== "message.part.delta") {
      output.push(event)
      return
    }
    const props = event.payload.properties
    if (
      !props ||
      typeof props !== "object" ||
      Array.isArray(props) ||
      typeof props.messageID !== "string" ||
      typeof props.partID !== "string" ||
      typeof props.field !== "string" ||
      typeof props.delta !== "string"
    ) {
      output.push(event)
      return
    }
    const previous = output[output.length - 1]
    if (
      !previous ||
      previous.payload.type !== "message.part.delta" ||
      previous.directory !== event.directory ||
      previous.payload.properties.messageID !== props.messageID ||
      previous.payload.properties.partID !== props.partID ||
      previous.payload.properties.field !== props.field
    ) {
      output.push({
        directory: event.directory,
        payload: { ...event.payload, properties: { ...props } },
      })
      return
    }
    output[output.length - 1] = {
      directory: event.directory,
      payload: {
        ...event.payload,
        properties: { ...props, delta: previous.payload.properties.delta + props.delta },
      },
    }
  })
  return output
}

function currentDelta(event: unknown): CurrentDelta | undefined {
  if (!event || typeof event !== "object") return
  const type = (event as { type?: unknown }).type
  if (
    type === "session.text.delta" ||
    type === "session.reasoning.delta" ||
    type === "session.tool.input.delta" ||
    type === "session.compaction.delta"
  ) {
    const data = (event as { data?: unknown }).data
    if (!data || typeof data !== "object" || Array.isArray(data)) return
    if (type === "session.compaction.delta") {
      if (typeof (data as { sessionID?: unknown }).sessionID !== "string") return
      if (typeof (data as { text?: unknown }).text !== "string") return
    } else if (
      typeof (data as { sessionID?: unknown }).sessionID !== "string" ||
      typeof (data as { delta?: unknown }).delta !== "string"
    ) return
    return event as CurrentDelta
  }
}

function currentDeltaKey(event: CurrentDelta) {
  if (event.type === "session.tool.input.delta")
    return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.callID}`
  if (event.type === "session.compaction.delta") return `${event.type}:${event.data.sessionID}`
  return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.ordinal}`
}

function currentDeltaFragment(event: CurrentDelta) {
  return event.type === "session.compaction.delta" ? event.data.text : event.data.delta
}

export function resumeStreamAfterPageShow(_event: PageTransitionEvent, start: () => unknown) {
  // Safari can restore a page without setting persisted. start() is idempotent.
  start()
}

type ServerEventEmitter = ReturnType<typeof createGlobalEmitter<{ [key: string]: ServerEvent }>>

export function dispatchServerEvents<T>(
  events: readonly T[],
  emit: (event: T) => void,
  onError: (error: unknown, event: T) => void = () => {},
) {
  for (const event of events) {
    try {
      emit(event)
    } catch (error) {
      onError(error, event)
    }
  }
}

type ServerSDKBase = {
  server: ServerConnection.Any
  scope: ServerScope
  protocol: Promise<ServerProtocol>
  protocolKind: Accessor<ServerProtocol | undefined>
  connection: {
    get snapshot(): ReturnType<typeof createConnectionManager>["snapshot"]
    onChange: (listener: (snapshot: ReturnType<typeof createConnectionManager>["snapshot"]) => void) => () => void
    markStateResyncing: () => void
    markSynchronized: () => void
    reconnect: () => Promise<ServerProtocol>
  }
  url: string
  client: ReturnType<typeof createSdkForServer>
  api: CompatibleApi
  currentApi: ServerApi
  event: {
    on: ServerEventEmitter["on"]
    listen: ServerEventEmitter["listen"]
    start: () => Promise<void> | undefined
  }
  createClient: (
    opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">,
  ) => ReturnType<typeof createSdkForServer>
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const abort = new AbortController()
  const transportServer = {
    ...server,
    http: { ...server.http, url: server.http.url },
  }

  const eventFetch = (() => {
    if (!platform.fetch || !server) return
    try {
      const url = new URL(transportServer.http.url)
      const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
      if (url.protocol === "http:" && !loopback) return platform.fetch
    } catch {
      return
    }
  })()

  const eventSdk = createSdkForServer({
    signal: abort.signal,
    fetch: eventFetch ? withoutEventReplay(eventFetch) : withoutEventReplay(globalThis.fetch),
    server: transportServer.http,
  })
  const connectionListeners = new Set<(snapshot: ReturnType<typeof createConnectionManager>["snapshot"]) => void>()
  const manager = createConnectionManager({
    probe: async () => {
      const value = await detectServerProtocol(transportServer.http, platform.fetch ?? globalThis.fetch)
      if (value === "unknown") throw new Error("Unable to determine the OpenCode API protocol")
      return value
    },
    onChange: (snapshot) => {
      for (const listener of connectionListeners) listener(snapshot)
    },
  })
  const waitForConnection = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const connectUntilReady = async (): Promise<ServerProtocol> => {
    while (!abort.signal.aborted) {
      try {
        return await manager.connect()
      } catch {
        if (abort.signal.aborted) break
        await waitForConnection(manager.retryDelay())
        if (manager.isCircuitOpen()) manager.reset()
      }
    }
    return new Promise<ServerProtocol>(() => {})
  }
  const protocol = connectUntilReady()
  const [protocolKind] = createResource(() => protocol)
  const emitter = createGlobalEmitter<{
    [key: string]: ServerEvent
  }>()

  type Queued = QueuedServerEvent
  const FLUSH_FRAME_MS = 16
  const STREAM_YIELD_MS = 8
  const RECONNECT_DELAY_MS = 250

  let queue: Queued[] = []
  let buffer: Queued[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined

    if (queue.length === 0) return

    const events = queue
    queue = buffer
    buffer = events
    queue.length = 0

    last = Date.now()
    const output = coalesceServerEvents(events)
    batch(() => {
      dispatchServerEvents(
        output,
        (event) => emitter.emit(event.directory, event.payload),
        (error, event) => {
          console.error("[global-sdk] event dispatch failed", {
            serverId: transportServer.http.id,
            type: event.payload.type,
            eventId: event.payload.id,
            error: error instanceof Error ? error.message : "unknown event error",
          })
          void clientDiagnostics.report("sse.event_dispatch_error", { backendId: transportServer.http.id, errorCode: error instanceof Error ? error.name : "EVENT_DISPATCH_ERROR" })
        },
      )
    })

    buffer.length = 0
  }

  const schedule = () => {
    if (timer) return
    const elapsed = Date.now() - last
    timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
  }

  let streamErrorLogged = false
  const wait = waitForConnection
  let attempt: AbortController | undefined
  let run: Promise<void> | undefined
  let started = false
  let generation = 0

  const start = () => {
    if (started) return run
    started = true
    const active = ++generation
    const previous = run
    const current = (async () => {
      if (previous) await previous
      // oxlint-disable-next-line no-unmodified-loop-condition -- `started` is set to false by stop() which also aborts; both flags are checked to allow graceful exit
      while (!abort.signal.aborted && started && generation === active) {
        attempt = new AbortController()
        const onAbort = () => {
          attempt?.abort()
        }
        abort.signal.addEventListener("abort", onAbort)
        let streamEnded = false
        try {
          const kind = await manager.connect()
          const events =
            kind === "v1"
              ? (await eventSdk.global.event({ signal: attempt.signal })).stream
              : kind === "v2"
                ? (await eventSdk.v2.event.subscribe({ signal: attempt.signal })).stream
                : (() => {
                    throw new Error("Unable to determine the OpenCode event protocol")
                })()
          manager.markStreamReady()
          void clientDiagnostics.report("sse.connect.ready", {
            backendId: transportServer.http.id,
            protocol: kind,
            operation: "event_stream",
          })
          let firstEvent = true
          let yielded = Date.now()
          for await (const event of events) {
            try {
              streamErrorLogged = false
              const legacy = "payload" in event
              if (legacy && event.payload.type === "sync") continue
              const directory = legacy ? (event.directory ?? "global") : (event.location?.directory ?? "global")
              const payload = legacy ? (event.payload as Event) : adaptServerEvent(event)
              if (firstEvent) {
                firstEvent = false
                void clientDiagnostics.report("sse.first_event", {
                  backendId: transportServer.http.id,
                  protocol: kind,
                  operation: "event_stream",
                  eventType: payload.type,
                  eventId: payload.id,
                })
              }
              if (enqueueServerEvent(queue, { directory, payload })) schedule()
            } catch (error) {
              console.error("[global-sdk] event quarantined", {
                serverId: transportServer.http.id,
                error: error instanceof Error ? error.message : "invalid event payload",
              })
              void clientDiagnostics.report("sse.event_quarantined", { backendId: transportServer.http.id, errorCode: error instanceof Error ? error.name : "EVENT_PAYLOAD_INVALID" })
              continue
            }

            if (Date.now() - yielded < STREAM_YIELD_MS) continue
            yielded = Date.now()
            await wait(0)
          }
          streamEnded = true
        } catch (error) {
          if (!isStreamClosed(error, attempt?.signal)) manager.markStreamFailure(error)
          if (!isStreamClosed(error, attempt?.signal) && !streamErrorLogged) {
            streamErrorLogged = true
            console.error("[global-sdk] event stream failed", {
              serverId: transportServer.http.id,
              fetch: eventFetch ? "platform" : "webview",
              error: error instanceof Error ? error.message : "unknown stream error",
            })
            void clientDiagnostics.reportSseFailure({ backendId: transportServer.http.id, errorCode: error instanceof Error ? error.name : "SSE_STREAM_FAILED" })
          }
        } finally {
          abort.signal.removeEventListener("abort", onAbort)
          attempt = undefined
        }

        // The event endpoint is long-lived. A clean EOF is still a transport
        // failure for our purposes: it can occur after the server persisted a
        // terminal execution event but before the browser received it. Force
        // the next attempt through protocol detection and authoritative sync.
        if (streamEnded && !abort.signal.aborted && started && generation === active)
          manager.markStreamFailure(new Error("OpenCode event stream closed"))

        if (abort.signal.aborted || !started || generation !== active) return
        await wait(manager.retryDelay() || RECONNECT_DELAY_MS)
        if (manager.isCircuitOpen()) manager.reset()
      }
    })().finally(() => {
      if (run !== current) return
      run = undefined
      flush()
    })
    run = current
    return run
  }

  const stop = () => {
    started = false
    generation++
    attempt?.abort()
  }

  onMount(() => {
    const recover = () => {
      manager.markStateResyncing()
      start()
    }
    makeEventListener(window, "pagehide", stop)
    makeEventListener(window, "pageshow", (event) => resumeStreamAfterPageShow(event, recover))
    makeEventListener(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") recover()
    })
    makeEventListener(window, "online", recover)
    makeEventListener(window, "offline", () => {
      stop()
      manager.invalidate(new Error("Network offline"))
    })
  })

  onCleanup(() => {
    stop()
    abort.abort()
    flush()
  })

  const sdk = createSdkForServer({
    server: transportServer.http,
    fetch: platform.fetch,
    throwOnError: true,
  })
  const currentApi: ServerApi = createApiForServer({ server: transportServer.http, fetch: platform.fetch })
  const legacy = (directory?: string) =>
    createSdkForServer({
      server: transportServer.http,
      fetch: platform.fetch,
      throwOnError: true,
      directory,
    })
  const api = createCompatibleApi({ protocol, current: currentApi, currentV2: sdk, legacy })

  return {
    server,
    scope,
    protocol,
    protocolKind,
    connection: {
      get snapshot() {
        return manager.snapshot
      },
      onChange(listener) {
        connectionListeners.add(listener)
        return () => connectionListeners.delete(listener)
      },
      markStateResyncing() {
        manager.markStateResyncing()
      },
      markSynchronized() {
        manager.markSynchronized()
      },
      reconnect() {
        stop()
        manager.reset()
        start()
        return manager.connect()
      },
    },
    url: transportServer.http.url,
    client: sdk,
    api,
    currentApi,
    event: {
      on: emitter.on.bind(emitter),
      listen: emitter.listen.bind(emitter),
      start,
    },
    createClient(opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">) {
      return createSdkForServer({
        server: transportServer.http,
        fetch: platform.fetch,
        ...opts,
      })
    },
  }
}

export type ServerSDK = ServerSDKBase & {
  ensureDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)
  return Object.assign(sdk, {
    ensureDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const { use: useServerSDK, provider: ServerSDKProvider } = createSimpleContext({
  name: "ServerSDK",
  // Returns an accessor so the resolved server can change reactively (e.g. a
  // /new-session draft retargeting its server) without re-instantiating the subtree.
  init: (props: { server?: Accessor<ServerConnection.Any | undefined> }) => {
    const global = useGlobal()
    const language = useLanguage()
    const server = useServer()

    return createMemo<ServerSDK>(() => {
      const conn = props.server?.() ?? server.current
      if (!conn) throw new Error(language.t("error.serverSDK.noServerAvailable"))
      return global.ensureServerCtx(conn).sdk
    })
  },
})

export function useServerProtocol() {
  const serverSDK = useServerSDK()
  return createMemo(() => serverSDK().protocolKind())
}

type SDKEventMap = {
  [key in Event["type"]]: Extract<ServerEvent, { type: key }>
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase) {
  const client = serverSDK.createClient({
    directory,
    throwOnError: true,
  })

  const emitter = createGlobalEmitter<SDKEventMap>()

  const unsub = serverSDK.event.on(directory, (event) => {
    emitter.emit(event.type, event)
  })
  onCleanup(unsub)

  return {
    scope: serverSDK.scope,
    protocol: serverSDK.protocol,
    directory,
    client,
    api: createCompatibleApi({
      protocol: serverSDK.protocol,
      current: serverSDK.currentApi,
      currentV2: client,
      legacy: (next) => serverSDK.createClient({ directory: next ?? directory, throwOnError: true }),
      directory,
    }),
    event: emitter,
    get url() {
      return serverSDK.url
    },
    createClient(opts: Parameters<typeof serverSDK.createClient>[0]) {
      return serverSDK.createClient(opts)
    },
  }
}
