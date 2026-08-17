import type { NextApiRequest, NextApiResponse } from "next"
import { getServer, publicServer, updateServerHealth } from "@/server/server-registry"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" })
  const server = await getServer(String(req.query.serverId))
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" })
  try {
    const target = new URL(server.baseUrl)
    const response = await fetch(new URL(`${target.pathname.replace(/\/$/, "")}/global/health`, target.origin), {
      headers: server.password ? { Authorization: `Basic ${Buffer.from(`${server.username || "opencode"}:${server.password}`).toString("base64")}` } : undefined,
      signal: AbortSignal.timeout(5000),
    })
    const next = await updateServerHealth(server.id, { state: response.ok ? "READY" : "UNHEALTHY", protocol: response.ok ? "v1" : undefined })
    return res.status(response.ok ? 200 : 502).json({ server: publicServer(next || server), error: response.ok ? undefined : "OPENCODE_HEALTH_FAILED" })
  } catch {
    const next = await updateServerHealth(server.id, { state: "UNHEALTHY", protocol: undefined })
    return res.status(502).json({ server: publicServer(next || server), error: "GATEWAY_CANNOT_REACH_SERVER" })
  }
}
