import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("./dialog-select-server.tsx", import.meta.url), "utf8")

describe("server add proxy fallback", () => {
  it("persists the proxy URL when the proxy is the endpoint that passed health", () => {
    expect(source).toContain("let connection = conn")
    expect(source).toContain("connection = { ...conn, http: { ...conn.http, url: proxyHttp.url } }")
    expect(source).toContain("server.add(connection)")
    expect(source).toContain("global.settings.server.set(ServerConnection.key(added))")
  })
})
