import type { NextApiRequest, NextApiResponse } from "next"
import { getServer, probeRegisteredServer, publicServer, updateServerHealth } from "@/server/server-registry"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const server = await getServer(String(req.query.serverId))
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" })
  const probe = await probeRegisteredServer(server.id)
  const updated = await updateServerHealth(server.id, { state: probe.state, protocol: probe.protocol, reachable: probe.reachable, authenticated: probe.authenticated, healthy: probe.healthy, latencyMs: probe.latencyMs, error: probe.error })
  return res.status(200).json({ server: publicServer(updated || server), ...probe })
}
