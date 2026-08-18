import { sentryVitePlugin } from "@sentry/vite-plugin"
import { request as httpRequest } from "node:http"
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

const controlServerPort = Number(process.env.OPENCODE_PROXY_PORT ?? 8787)
function forwardToControlServer(req: any, res: any, next: () => void) {
  const upstream = httpRequest({ hostname: "127.0.0.1", port: controlServerPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${controlServerPort}` } }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers)
    response.pipe(res)
  })
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 503
      res.setHeader("content-type", "application/json; charset=utf-8")
      res.end(JSON.stringify({ error: "CONTROL_SERVER_UNAVAILABLE" }))
    } else {
      next()
    }
  })
  req.pipe(upstream)
}

const universalServerProxy = {
  name: "opencode-universal-proxy",
  configureServer(server: { middlewares: { use: (handler: (req: any, res: any, next: () => void) => void) => void }; ssrLoadModule: (id: string) => Promise<{ handleControlPlaneRequest: (req: any, res: any, pathname: string) => Promise<boolean | void>; handleOpenCodeProxy: (req: any, res: any, next: () => void) => void }> }) {
    server.middlewares.use((req, res, next) => {
      const pathname = req.url ? new URL(req.url, "http://localhost").pathname : ""
      const isControl = pathname === "/api/bootstrap" || pathname === "/api/opencode/servers" || pathname.startsWith("/api/opencode/servers/")
      if (!isControl && !pathname.startsWith("/api/opencode/")) return next()
      forwardToControlServer(req, res, next)
    })
  },
}

export default defineConfig({
  plugins: [desktopPlugin, universalServerProxy, sentry] as any,
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
