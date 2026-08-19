import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import path from "path"

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../packages/app/src"),
    },
    dedupe: ["solid-js", "solid-js/web", "solid-js/store", "@solidjs/router"],
  },
  server: {
    host: "0.0.0.0",
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
  },
  define: {
    "import.meta.env.VITE_APP_RUNTIME": '"review"',
    "import.meta.env.VITE_SENTRY_RELEASE": '""',
    "import.meta.env.WEBUI_COMMIT_SHA": '""',
    "import.meta.env.WEBUI_CLIENT_ERROR_LOGGING": '""',
    "import.meta.env.OPENCODE_CHANNEL": '"dev"',
  },
  worker: {
    format: "es"
  }
})
