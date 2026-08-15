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

const buildId = process.env.VITE_SENTRY_RELEASE || process.env.GITHUB_SHA || Date.now().toString(36)

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
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
    chunkSizeWarningLimit: 10000, // vendor-shiki (9.6 MB) and ghostty-web (1.38 MB) are inherent to third-party libs
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shiki and its languages
          if (id.includes("/node_modules/shiki") || id.includes("/node_modules/@shikijs")) {
            return "vendor-shiki"
          }
          if (id.match(/\/node_modules\/@shikijs\/(langs|core|wasm)/)) {
            return "vendor-shiki-core"
          }
          // Markdown parsing
          if (id.includes("/node_modules/marked") || id.includes("/node_modules/katex")) {
            return "vendor-markdown"
          }
          // Lucide icons (usually large if not tree-shaken well)
          if (id.includes("/node_modules/lucide-solid")) {
            return "vendor-icons"
          }
          // Solid.js framework core
          if (id.includes("/node_modules/solid-js") || id.includes("/node_modules/@solidjs")) {
            return "vendor-solid"
          }
          // Kobalte UI primitives
          if (id.includes("/node_modules/@kobalte") || id.includes("/node_modules/@corvu")) {
            return "vendor-ui-primitives"
          }
          // Effect functional library
          if (id.includes("/node_modules/effect") || id.includes("/node_modules/@effect")) {
            return "vendor-effect"
          }
          // TanStack Query & Virtual
          if (id.includes("/node_modules/@tanstack")) {
            return "vendor-tanstack"
          }
          // Zod schema validation
          if (id.includes("/node_modules/zod")) {
            return "vendor-zod"
          }
          // Sentry error tracking
          if (id.includes("/node_modules/@sentry")) {
            return "vendor-sentry"
          }
          // Internal UI packages
          if (id.includes("/packages/session-ui/")) {
            return "pkg-session-ui"
          }
          if (id.includes("/packages/ui/")) {
            return "pkg-ui"
          }
          // Monaco/Editor (if any)
          if (id.includes("/node_modules/monaco-editor")) {
            return "vendor-editor"
          }
        },
      },
    },
  },
})
