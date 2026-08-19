import { Hono } from "hono"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import { join, resolve } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import { handleControlPlaneRequest } from "./control-plane-api"
import { handleOpenCodeProxy } from "./proxy"
import { createUnifiedRuntimeMiddleware } from "./unified-runtime"
import { listBackendDescriptors } from "./services/backend-service"
import { runtimeLogger } from "./observability/logger"
import { authorizeWebUIRequest, validateWebUIAuthConfiguration } from "./web-ui-auth"

const root = resolve(fileURLToPath(new URL("../../dist", import.meta.url)))
const runtimeMiddleware = createUnifiedRuntimeMiddleware({ control: handleControlPlaneRequest, gateway: handleOpenCodeProxy })

function contentType(pathname: string) {
  if (pathname === "/" || pathname.endsWith(".html")) return "text/html; charset=utf-8"
  const ext = pathname.slice(pathname.lastIndexOf(".")).toLowerCase()
  return ({
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  } as Record<string, string>)[ext] || "application/octet-stream"
}

async function staticResponse(request: Request) {
  const url = new URL(request.url)
  const pathname = decodeURIComponent(url.pathname)
  if (pathname.startsWith("/@vite/") || pathname.startsWith("/src/") || pathname.startsWith("/node_modules/")) return new Response("Not found", { status: 404 })

  const relative = pathname === "/" ? "index.html" : pathname.slice(1)
  const candidate = resolve(join(root, relative))
  if (!candidate.startsWith(`${root}/`) && candidate !== root) return new Response("Not found", { status: 404 })
  const file = Bun.file(candidate)
  if (!(await file.exists())) {
    if (pathname.startsWith("/assets/")) return new Response("Not found", { status: 404 })
    const index = Bun.file(join(root, "index.html"))
    if (!(await index.exists())) return new Response("Not found", { status: 404 })
    return new Response(index, { headers: { "cache-control": "no-cache", "content-type": "text/html; charset=utf-8" } })
  }

  const hashedAsset = pathname.startsWith("/assets/")
  return new Response(file, {
    headers: {
      "cache-control": hashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
      "content-type": contentType(pathname),
    },
  })
}

function nodeRequest(request: Request): IncomingMessage & { method: string; url: string } {
  const stream = request.body ? Readable.fromWeb(request.body as any) : Readable.from([])
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const emit = (event: string, ...args: any[]) => listeners.get(event)?.forEach((listener) => listener(...args))
  request.signal.addEventListener("abort", () => emit("aborted"), { once: true })

  const req = stream as IncomingMessage & { method: string; url: string }
  Object.assign(req, {
    method: request.method,
    url: `${new URL(request.url).pathname}${new URL(request.url).search}`,
    headers: Object.fromEntries(request.headers.entries()),
    once(event: string, listener: (...args: any[]) => void) {
      const set = listeners.get(event) || new Set()
      set.add(listener)
      listeners.set(event, set)
      return req
    },
    removeListener(event: string, listener: (...args: any[]) => void) {
      listeners.get(event)?.delete(listener)
      return req
    },
  })
  return req
}

export function nodeResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let committed = false
  let closed = false
  let responseResolve!: (response: Response) => void
  const responseReady = new Promise<Response>((resolveResponse) => { responseResolve = resolveResponse })
  const headers = new Headers()
  const stream = new ReadableStream<Uint8Array>({
    start(next) { controller = next },
    cancel() { emit("close") },
  })
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const emit = (event: string, ...args: any[]) => listeners.get(event)?.forEach((listener) => listener(...args))
  const commit = () => {
    if (committed) return
    committed = true
    responseResolve(new Response(stream, { status: response.statusCode, headers }))
  }
  const response = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : String(value))
      return response
    },
    getHeader(name: string) { return headers.get(name) ?? undefined },
    write(chunk: Uint8Array | string) {
      if (closed) return false
      response.headersSent = true
      commit()
      controller?.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk))
      return true
    },
    end(chunk?: Uint8Array | string) {
      if (closed) return response
      if (chunk !== undefined) response.write(chunk)
      closed = true
      response.headersSent = true
      commit()
      controller?.close()
      emit("close")
      return response
    },
    once(event: string, listener: (...args: any[]) => void) {
      const set = listeners.get(event) || new Set()
      set.add(listener)
      listeners.set(event, set)
      return response
    },
    removeListener(event: string, listener: (...args: any[]) => void) {
      listeners.get(event)?.delete(listener)
      return response
    },
  } as unknown as ServerResponse & { headersSent: boolean; statusCode: number }
  return { response, responseReady }
}

async function apiResponse(request: Request) {
  const req = nodeRequest(request)
  const { response, responseReady } = nodeResponse()
  void runtimeMiddleware(req, response, () => {
    response.statusCode = 404
    response.setHeader("content-type", "application/json; charset=utf-8")
    response.end(JSON.stringify({ error: "NOT_FOUND" }))
  }).catch((error) => {
    runtimeLogger.error("production.request.error", { error })
    if (!response.headersSent) {
      response.statusCode = 500
      response.setHeader("content-type", "application/json; charset=utf-8")
      response.end(JSON.stringify({ error: "WEB_RUNTIME_REQUEST_FAILED" }))
    }
  })
  return responseReady
}

export function createProductionApp() {
  const app = new Hono()
  app.all("*", async (context) => {
    const authorization = authorizeWebUIRequest(context.req.raw.headers)
    if (!authorization.allowed) {
      if (authorization.status === 401) context.header("www-authenticate", "Basic realm=web-ui")
      return context.json({ error: authorization.error }, authorization.status as 401 | 503)
    }
    if (new URL(context.req.raw.url).pathname.startsWith("/api/")) return apiResponse(context.req.raw)
    return staticResponse(context.req.raw)
  })
  return app
}

export function createProductionServerOptions(app: Hono, hostname: string, port: number) {
  return {
    hostname,
    port,
    // Bun defaults idle connections to 10 seconds. The event endpoint is a
    // deliberately long-lived SSE response and must remain open while the
    // upstream is quiet between heartbeats/events.
    idleTimeout: 0,
    fetch: app.fetch,
  }
}

export async function startProductionServer() {
  const hostname = process.env.WEBUI_BIND_HOST || "127.0.0.1"
  const port = Number(process.env.WEBUI_PORT || process.env.PORT || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("INVALID_WEBUI_PORT")
  validateWebUIAuthConfiguration()
  const app = createProductionApp()
  const server = Bun.serve(createProductionServerOptions(app, hostname, port))
  runtimeLogger.info("application.start", {
    version: process.env.WEBUI_COMMIT_SHA || "unknown",
    environment: process.env.NODE_ENV || "production",
    bindHost: hostname,
    bindPort: port,
    distRoot: root,
    dbMode: process.env.CONTROL_PLANE_DB ? "configured" : "default",
    logLevel: runtimeLogger.level,
    logFormat: runtimeLogger.format,
    clientTelemetryEnabled: process.env.WEBUI_CLIENT_ERROR_LOGGING === "1",
    standaloneProxy: "disabled",
    encryptionKeyConfigured: Boolean(process.env.APP_ENCRYPTION_KEY),
  })
  try {
    const backends = await listBackendDescriptors()
    runtimeLogger.info("application.ready", { backendCount: backends.length, enabledBackendCount: backends.filter((backend) => backend.enabled).length })
  } catch (error) {
    runtimeLogger.error("application.ready.error", { error })
  }
  const shutdown = async (reason: string) => {
    runtimeLogger.info("application.shutdown", { reason })
    await server.stop(true)
  }
  process.once("SIGTERM", () => void shutdown("SIGTERM"))
  process.once("SIGINT", () => void shutdown("SIGINT"))
  return server
}

if (import.meta.main) await startProductionServer()
