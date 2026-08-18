import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
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
