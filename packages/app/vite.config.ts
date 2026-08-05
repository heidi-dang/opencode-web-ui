import { sentryVitePlugin } from "@sentry/vite-plugin"
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

function validateProxyUrl(raw) {
  if (!raw) return "http://127.0.0.1:4096"
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Configuration error: VITE_OPENCODE_SERVER_URL "${raw}" is not a valid URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Configuration error: Unsupported protocol "${url.protocol}" in VITE_OPENCODE_SERVER_URL. Only http and https are allowed.`)
  }
  if (url.username || url.password) {
    throw new Error(`Configuration error: VITE_OPENCODE_SERVER_URL must not contain credentials (username or password). Use separate auth configuration instead.`)
  }
  return raw
}

const serverUrl = process.env.VITE_OPENCODE_SERVER_URL || ""
const validatedUrl = serverUrl ? validateProxyUrl(serverUrl) : null

const proxyTarget = validatedUrl
  ? validatedUrl
  : `http://127.0.0.1:${process.env.VITE_OPENCODE_SERVER_PORT || "4096"}`

const hopByHopHeaders = [
  "keep-alive", "transfer-encoding", "te", "connection",
  "trailer", "upgrade", "proxy-authorization", "proxy-authenticate",
]

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024

export default defineConfig({
  plugins: [desktopPlugin, sentry].filter(Boolean),
  server: {
    host: "127.0.0.1",
    allowedHosts: [],
    port: 3000,
    proxy: {
      "/opencode-server": {
        target: proxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode-server/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            for (const header of hopByHopHeaders) {
              proxyReq.removeHeader(header)
            }
          })
          proxy.on("proxyReqWs", (proxyReq, req) => {
            for (const header of hopByHopHeaders) {
              proxyReq.removeHeader(header)
            }
          })
          proxy.on("error", (err, req, res) => {
            if (res && !res.headersSent) {
              res.statusCode = 502
              res.end()
            }
          })
        },
      },
    },
  },
  build: {
    target: "esnext",
    sourcemap: !!sentry,
    manifest: true,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Solid.js framework core
          if (id.includes("/node_modules/solid-js") || id.includes("/node_modules/@solidjs")) {
            return "vendor-solid"
          }
          // Kobalte UI primitives
          if (id.includes("/node_modules/@kobalte")) {
            return "vendor-kobalte"
          }
          // Effect functional library
          if (id.includes("/node_modules/effect") || id.includes("/node_modules/@effect")) {
            return "vendor-effect"
          }
          // TanStack Query
          if (id.includes("/node_modules/@tanstack")) {
            return "vendor-tanstack"
          }
          // Zod schema validation
          if (id.includes("/node_modules/zod")) {
            return "vendor-zod"
          }
          // Sentry error tracking (can be deferred)
          if (id.includes("/node_modules/@sentry")) {
            return "vendor-sentry"
          }
        },
      },
    },
  },
})
