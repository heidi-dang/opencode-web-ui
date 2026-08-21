import { readFileSync } from "node:fs"
import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig, loadEnv } from "vite"
import desktopPlugin from "./vite"
import { handleControlPlaneRequest } from "./src/server/control-plane-api"
import { handleOpenCodeProxy } from "./src/server/proxy"
import { createUnifiedRuntimeMiddleware } from "./src/server/unified-runtime"
import { runtimeLogger } from "./src/server/observability/logger"
import { listBackendDescriptors } from "./src/server/services/backend-service"
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

const universalServerProxy = {
  name: "opencode-universal-proxy",
  configureServer(server: { middlewares: { use: (handler: (req: any, res: any, next: () => void) => void) => void }; httpServer?: { once: (event: string, listener: () => void) => void } }) {
    runtimeLogger.info("application.start", {
      version: process.env.WEBUI_COMMIT_SHA || process.env.VITE_SENTRY_RELEASE || "unknown",
      environment: process.env.NODE_ENV || "development",
      bindHost: "127.0.0.1",
      bindPort: 3000,
      dbMode: process.env.CONTROL_PLANE_DB ? "configured" : "default",
      logLevel: runtimeLogger.level,
      logFormat: runtimeLogger.format,
      clientTelemetryEnabled: process.env.WEBUI_CLIENT_ERROR_LOGGING === "1",
      standaloneProxy: "disabled",
      encryptionKeyConfigured: Boolean(process.env.APP_ENCRYPTION_KEY),
    })
    server.middlewares.use(createUnifiedRuntimeMiddleware({ control: handleControlPlaneRequest, gateway: handleOpenCodeProxy }))
    server.httpServer?.once("listening", () => {
      void listBackendDescriptors()
        .then((backends) => runtimeLogger.info("application.ready", { backendCount: backends.length, enabledBackendCount: backends.filter((backend) => backend.enabled).length }))
        .catch((error) => runtimeLogger.error("application.ready.error", { error }))
    })
    server.httpServer?.once("close", () => runtimeLogger.info("application.shutdown", { reason: "http_server_closed" }))
  },
}

export default defineConfig(({ mode }) => {
  // Vite loads .env files into import.meta.env, but the server/control-plane
  // modules intentionally read process.env. Bridge only the server-side secrets
  // before any request handlers are created.
  const env = loadEnv(mode, process.cwd(), "")
  const projectEnvPaths = ["/vercel/share/.env.project", `${process.cwd()}/.env.development.local`, `${process.cwd()}/../.env.development.local`]
  let projectEnv: Record<string, string> = {}
  try {
    const projectEnvPath = projectEnvPaths.find((path) => {
      try {
        readFileSync(path)
        return true
      } catch {
        return false
      }
    })
    if (!projectEnvPath) throw new Error("project environment file not found")
    projectEnv = Object.fromEntries(
      readFileSync(projectEnvPath, "utf8")
        .split(/\r?\n/)
        .flatMap((line) => {
          const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
          if (!match) return []
          const value = match[2].replace(/^(['"])(.*)\1$/, "$2")
          return [[match[1], value]] as const
        }),
    )
  } catch {
    // Production and non-v0 environments provide secrets through process.env.
  }
  for (const key of ["APP_ENCRYPTION_KEY", "APP_ENCRYPTION_KEY_2", "CONTROL_PLANE_DB", "OPENCODE_ALLOWED_SERVERS", "WEBUI_BIND_HOST"]) {
    const value = process.env[key] || env[key] || projectEnv[key]
    if (value) process.env[key] = value
  }

  return {
    plugins: [desktopPlugin, universalServerProxy, sentry] as any,
    server: {
      host: "0.0.0.0",
      allowedHosts: ["localhost", "127.0.0.1"],
      port: 3000,
    },
    build: {
      target: "esnext",
      sourcemap: true,
    },
  }
})
