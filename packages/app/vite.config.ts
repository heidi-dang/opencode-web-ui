import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"
import { appendFileSync } from "node:fs"
import { resolve } from "node:path"

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

const mobileLogFile = resolve(__dirname, "../../mobile-debug.log")

const remoteProxyPlugin = {
  name: "remote-proxy-gateway",
  configureServer(server: any) {
    server.middlewares.use("/api/remote-proxy", async (req: any, res: any) => {
      const targetUrl = req.headers["x-target-url"] as string
      if (!targetUrl) {
        res.statusCode = 400
        return res.end("Missing X-Target-URL header")
      }
      try {
        const headers: Record<string, string> = {}
        if (req.headers["authorization"]) headers["authorization"] = req.headers["authorization"] as string
        if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"] as string

        const remoteRes = await fetch(targetUrl, {
          method: req.method || "GET",
          headers,
          signal: AbortSignal.timeout(6000),
        })

        res.statusCode = remoteRes.status
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Headers", "*")
        const arrayBuffer = await remoteRes.arrayBuffer()
        res.end(Buffer.from(arrayBuffer))
      } catch (err: any) {
        res.statusCode = 502
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.end(JSON.stringify({ error: err?.message || String(err) }))
      }
    })
  },
}

const mobileLogPlugin = {
  name: "mobile-log-receiver",
  configureServer(server: any) {
    server.middlewares.use("/api/mobile-log", (req: any, res: any) => {
      if (req.method === "POST") {
        let body = ""
        req.on("data", (chunk: any) => { body += chunk })
        req.on("end", () => {
          const timestamp = new Date().toISOString()
          const entry = `[${timestamp}] ${body}\n`
          try { appendFileSync(mobileLogFile, entry, "utf8") } catch {}
          console.log("\n📱 [MOBILE REMOTE LOG]:", body)
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ ok: true }))
        })
      } else {
        res.end("OK")
      }
    })
  },
}

export default defineConfig({
  plugins: [desktopPlugin, mobileLogPlugin, remoteProxyPlugin, sentry] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      "/opencode-server": {
        target: `http://127.0.0.1:${process.env.VITE_OPENCODE_SERVER_PORT || "4096"}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode-server/, ""),
      },
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
