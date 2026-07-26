import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

// ── Sentry ──────────────────────────────────────────────────────────────
const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

// ── Development proxy for opencode serve ───────────────────────────────
// Only active when VITE_OPENCODE_SERVER_URL is set.
// The destination is fixed at process startup and cannot be changed by browser requests.
const serverUrl = process.env.VITE_OPENCODE_SERVER_URL || ""
const devProxyPlugin = serverUrl
  ? {
      name: "opencode-dev-proxy" as const,
      configureServer(server: any) {
        // Validate the URL at startup
        let target: URL
        try {
          target = new URL(serverUrl)
          if (target.username || target.password) {
            console.error("[opencode-dev-proxy] Credentials in VITE_OPENCODE_SERVER_URL are not supported. Use env vars instead.")
            target = new URL(`${target.protocol}//${target.host}${target.pathname}`)
          }
        } catch {
          console.error("[opencode-dev-proxy] Invalid VITE_OPENCODE_SERVER_URL:", serverUrl)
          return
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          console.error("[opencode-dev-proxy] Unsupported protocol:", target.protocol)
          return
        }

        const targetOrigin = target.origin
        server.middlewares.use("/opencode-server", async (req: any, res: any) => {
          const url = new URL(req.url || "/", targetOrigin)
          try {
            const headers: Record<string, string> = {
              "host": target.host,
            }
            // Forward auth if present in the original request
            if (req.headers["authorization"]) {
              headers["authorization"] = req.headers["authorization"]
            }
            if (req.headers["content-type"]) {
              headers["content-type"] = req.headers["content-type"]
            }

            // Pipe the request body for non-GET methods
            const body = req.method !== "GET" && req.method !== "HEAD"
              ? await new Promise<Buffer>((resolve) => {
                  const chunks: Buffer[] = []
                  req.on("data", (chunk: Buffer) => chunks.push(chunk))
                  req.on("end", () => resolve(Buffer.concat(chunks)))
                })
              : undefined

            const controller = new AbortController()
            req.on("close", () => controller.abort())

            const upstream = await fetch(url.toString(), {
              method: req.method || "GET",
              headers,
              body,
              signal: controller.signal,
            })

            // Remove hop-by-hop headers
            const hopByHop = [
              "transfer-encoding", "connection", "keep-alive",
              "proxy-authenticate", "proxy-authorization",
              "te", "trailers", "upgrade",
            ]
            res.statusCode = upstream.status
            for (const [key, value] of upstream.headers) {
              if (!hopByHop.includes(key.toLowerCase())) {
                res.setHeader(key, value)
              }
            }

            // Stream the response body (supports SSE)
            if (upstream.body) {
              const reader = upstream.body.getReader()
              const pump = () => {
                reader.read().then(({ done, value }) => {
                  if (done) { res.end(); return }
                  res.write(value)
                  pump()
                }).catch(() => { res.end() })
              }
              pump()
            } else {
              const text = await upstream.text()
              res.end(text)
            }
          } catch (err: any) {
            if (err.name === "AbortError") {
              if (!res.writableEnded) res.end()
              return
            }
            res.statusCode = 502
            res.end(JSON.stringify({ error: err?.message || String(err) }))
          }
        })
      },
    }
  : false

// ── Mobile log receiver (dev-only, disabled by default) ─────────────────
const mobileLogPlugin = process.env.OPENCODE_MOBILE_LOG === "true"
  ? {
      name: "mobile-log-receiver" as const,
      configureServer(server: any) {
        server.middlewares.use("/api/mobile-log", (req: any, res: any) => {
          if (req.method === "POST") {
            let body = ""
            let size = 0
            const MAX_BODY = 65536 // 64 KB max
            req.on("data", (chunk: any) => {
              body += chunk
              size += chunk.length
              if (size > MAX_BODY) {
                req.destroy()
                res.statusCode = 413
                res.end(JSON.stringify({ error: "Payload too large" }))
              }
            })
            if (size > MAX_BODY) return
            req.on("end", () => {
              // Sanitize: strip control characters except newlines
              const sanitized = body.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
              // Redact sensitive patterns
              const redacted = sanitized
                .replace(/Authorization:\s*Basic\s+\S+/gi, "Authorization: Basic [REDACTED]")
                .replace(/"password"\s*:\s*"[^"]+"/gi, '"password":"[REDACTED]"')
                .replace(/"authToken"\s*:\s*"[^"]+"/gi, '"authToken":"[REDACTED]"')
              console.log("[mobile-log]", redacted)
              res.setHeader("Content-Type", "application/json")
              res.end(JSON.stringify({ ok: true }))
            })
          } else {
            res.end("OK")
          }
        })
      },
    }
  : false

// ── Host binding ─────────────────────────────────────────────────────────
// Default: loopback only. Set DEV_NETWORK_EXPOSE=true for network access.
const host = process.env.DEV_NETWORK_EXPOSE === "true" ? "0.0.0.0" : "127.0.0.1"

// Allowed hosts: never use `true`. Parse from env or default to loopback.
const allowedHostsInput = process.env.DEV_ALLOWED_HOSTS
const allowedHosts = allowedHostsInput
  ? allowedHostsInput.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined // loopback only by default

export default defineConfig({
  plugins: [desktopPlugin, mobileLogPlugin, devProxyPlugin, sentry].filter(Boolean) as any,
  server: {
    host,
    allowedHosts,
    port: 3000,
    proxy: !devProxyPlugin && process.env.VITE_OPENCODE_SERVER_URL
      ? {
          "/opencode-server": {
            target: process.env.VITE_OPENCODE_SERVER_URL,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/opencode-server/, ""),
          },
        }
      : undefined,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
