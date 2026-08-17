import type { NextApiRequest, NextApiResponse } from "next"
import { getServer, publicServer } from "@/server/server-registry"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const server = await getServer(String(req.query.serverId))
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" })
  const started = Date.now()
  try {
    const base = new URL(server.baseUrl)
    const response = await fetch(new URL(`${base.pathname.replace(/\/$/, "")}/global/health`, base.origin), {
      headers: server.password ? { Authorization: `Basic ${Buffer.from(`${server.username || "opencode"}:${server.password}`).toString("base64")}` } : undefined,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return res.status(502).json({ state: "UNHEALTHY", error: "OPENCODE_HEALTH_FAILED", status: response.status, latencyMs: Date.now() - started })
    return res.status(200).json({ server: publicServer(server), state: "READY", protocol: response.headers.get("x-opencode-version") ? "v2" : "v1", latencyMs: Date.now() - started })
  } catch (error) {
    return res.status(502).json({ state: "UNHEALTHY", error: error instanceof Error && error.name === "TimeoutError" ? "CONNECT_TIMEOUT" : "GATEWAY_CANNOT_REACH_SERVER" })
  }
}
