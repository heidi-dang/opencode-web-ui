import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"
import { handleControlPlaneRequest } from "./src/server/control-plane-api"
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
  configureServer(server: { middlewares: { use: (handler: (req: any, res: any, next: () => void) => void) => void }; ssrLoadModule: (id: string) => Promise<{ handleOpenCodeProxy: (req: any, res: any, next: () => void) => void }> }) {
    server.middlewares.use((req, res, next) => {
      const pathname = req.url ? new URL(req.url, "http://localhost").pathname : ""
      const isControl = pathname === "/api/bootstrap" || pathname === "/api/opencode/servers" || pathname.startsWith("/api/opencode/servers/")
      if (isControl) {
        void handleControlPlaneRequest(req, res, pathname).then((handled) => { if (handled === false) next() })
        return
      }
      if (!pathname.startsWith("/api/opencode/")) return next()
      void server.ssrLoadModule("/src/server/proxy.ts").then(({ handleOpenCodeProxy }) => handleOpenCodeProxy(req, res, next))
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
