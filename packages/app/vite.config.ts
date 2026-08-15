import { sentryVitePlugin } from "@sentry/vite-plugin"
import { Readable } from "node:stream"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

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

const dynamicServerProxy = {
  name: "opencode-dynamic-server-proxy",
  configureServer(server: { middlewares: { use: (path: string, handler: (req: any, res: any, next: () => void) => void) => void } }) {
    server.middlewares.use("/__opencode_remote__", async (req, res, next) => {
      try {
        const incoming = new URL(req.url ?? "/", "http://localhost")
        const target = incoming.searchParams.get("target")
        if (!target) return next()
        const targetOrigin = new URL(target).origin
        const targetUrl = `${targetOrigin}${incoming.pathname.replace(/^\/__opencode_remote__/, "") || "/"}${(() => {
          incoming.searchParams.delete("target")
          const query = incoming.searchParams.toString()
          return query ? `?${query}` : ""
        })()}`
        const headers = new Headers(req.headers as Record<string, string>)
        headers.delete("host")
        headers.delete("origin")
        const response = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
          duplex: "half",
        } as RequestInit & { duplex: "half" })
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        if (response.body) Readable.fromWeb(response.body as any).pipe(res)
        else res.end()
      } catch {
        if (!res.headersSent) res.statusCode = 502
        res.end("Unable to reach the configured OpenCode server")
      }
    })
  },
}

export default defineConfig({
  plugins: [desktopPlugin, dynamicServerProxy, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
