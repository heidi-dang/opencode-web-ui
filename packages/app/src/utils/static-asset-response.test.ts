import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const serviceWorker = readFileSync(resolve(import.meta.dir, "../../public/sw.js"), "utf8")
const caddySetup = readFileSync(resolve(import.meta.dir, "../../../../docs/deployment/caddy-setup.md"), "utf8")
const caddyRequirement = readFileSync(resolve(import.meta.dir, "../../../../docs/deployment/caddy-requirement.md"), "utf8")

describe("static asset hosting contract", () => {
  it("does not return SPA HTML for an asset request intercepted by the service worker", () => {
    expect(serviceWorker).toContain('if (url.pathname.startsWith("/assets/") && contentType.includes("text/html"))')
    expect(serviceWorker).toContain('status: 404')
    expect(serviceWorker).toContain('"Content-Type": "text/plain; charset=utf-8"')
  })

  it("keeps the Caddy asset handler ahead of the SPA fallback and returns 404 for missing assets", () => {
    for (const document of [caddySetup, caddyRequirement]) {
      expect(document).toContain("@immutable path /assets/*")
      expect(document).toContain("try_files {path} =404")
      expect(document).toContain("try_files {path} /index.html")
    }
  })
})
